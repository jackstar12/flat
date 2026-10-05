import { createHash } from "node:crypto";
import type { LocalDatabase, LocalStatement } from "./db";
import { roommateIds } from "../src/shared/config";
import { aggregateReceiptSplits } from "../src/shared/receipt";
import { allocateReceiptRatio, canonicalReceiptRatio, matchingReceiptRule, normalizeReceiptIdentity, sameReceiptSplits } from "../src/shared/receipt-learning";
import type { ReceiptAnalysis, ReceiptAssignmentRule, ReceiptItem, ReceiptLearningPayload } from "../src/shared/types";

export type AnalysisDraft = {
  id: string; actor_id: string; items_json: string; source_key: string;
  attachment_hash: string | null; transaction_id: string | null; payload_hash: string | null;
  finalized: number; invalidated: number;
};
export const receiptHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function getAnalysisDraft(db: LocalDatabase, id: string) {
  return db.prepare("SELECT * FROM receipt_analysis_drafts WHERE id = ?").bind(id).first<AnalysisDraft>();
}

export function learningState(db: LocalDatabase): ReceiptLearningPayload {
  const enabled = Boolean(db.prepare("SELECT enabled FROM receipt_learning_settings WHERE id = 1").first<{ enabled: number }>()!.enabled);
  const rows = db.prepare("SELECT * FROM receipt_corrections ORDER BY sequence DESC").all<{
    product_key: string; display_name: string; ratio_json: string;
  }>().results;
  const products = new Map<string, ReceiptLearningPayload["products"][number]>();
  const ratios = new Map<string, string[]>();
  for (const row of rows) {
    const recent = ratios.get(row.product_key) ?? [];
    if (recent.length >= 3) continue;
    recent.push(row.ratio_json);
    ratios.set(row.product_key, recent);
    products.set(row.product_key, { key: row.product_key, name: row.display_name, disabled: false,
      evidenceCount: recent.length, status: "pending", weights: null });
  }
  for (const product of products.values()) {
    const recent = ratios.get(product.key)!;
    product.status = new Set(recent).size > 1 ? "conflict" : recent.length >= 2 ? "active" : "pending";
    product.weights = product.status === "active" ? JSON.parse(recent[0]) : null;
  }
  for (const row of db.prepare("SELECT * FROM receipt_learning_products").all<{ product_key: string; disabled: number }>().results) {
    const product = products.get(row.product_key) ?? { key: row.product_key, name: row.product_key,
      evidenceCount: 0, status: "pending" as const, weights: null, disabled: false };
    product.disabled = Boolean(row.disabled);
    products.set(row.product_key, product);
  }
  return { enabled, products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name, "de")) };
}

export function applyReceiptLearning(db: LocalDatabase, analysis: ReceiptAnalysis, rules: ReceiptAssignmentRule[]): ReceiptAnalysis {
  const state = learningState(db);
  if (!state.enabled) return analysis;
  const items = analysis.items.map((item) => {
    if (matchingReceiptRule(item, rules) || item.assignmentReason.startsWith("WG-Regel:")) return item;
    const product = state.products.find((p) => p.key === normalizeReceiptIdentity(item.normalizedName));
    if (!product || product.disabled || product.status !== "active" || !product.weights) return item;
    return { ...item, splits: allocateReceiptRatio(item.amountCents, product.weights, roommateIds),
      assignmentReason: `Aus ${product.evidenceCount} bisherigen Korrekturen der WG vorgeschlagen. Bitte prüfen.` };
  });
  return { ...analysis, items, roommateTotals: aggregateReceiptSplits(items, roommateIds) };
}

// Only server-held initial analyses can produce evidence. Called in the same
// transaction as completion, never on an independent client feedback request.
export function correctionStatements(db: LocalDatabase, draft: AnalysisDraft, transactionId: string, final: ReceiptItem[]): LocalStatement[] {
  if (draft.finalized || draft.invalidated || !learningState(db).enabled) return [];
  const initial = JSON.parse(draft.items_json) as ReceiptItem[];
  const byProduct = new Map<string, { item: ReceiptItem; ratio: number[] }[]>();
  const rejected = new Set<string>();
  final.forEach((item, index) => {
    const key = normalizeReceiptIdentity(item.normalizedName);
    if (!key || !initial[index] || sameReceiptSplits(initial[index], item, roommateIds)) return;
    const ratio = canonicalReceiptRatio(item, roommateIds);
    if (!ratio) { rejected.add(key); return; }
    byProduct.set(key, [...(byProduct.get(key) ?? []), { item, ratio }]);
  });
  return [...byProduct].flatMap(([key, entries]) => {
    if (rejected.has(key) || new Set(entries.map((e) => JSON.stringify(e.ratio))).size !== 1 ||
      final.filter((item) => normalizeReceiptIdentity(item.normalizedName) === key)
        .some((item) => JSON.stringify(canonicalReceiptRatio(item, roommateIds)) !== JSON.stringify(entries[0].ratio)) ||
      db.prepare("SELECT 1 FROM receipt_learning_products WHERE product_key = ? AND disabled = 1").bind(key).first()) return [];
    const { item, ratio } = entries[0];
    return [db.prepare(`INSERT OR IGNORE INTO receipt_corrections
      (transaction_id, product_key, display_name, ratio_json, source_key) SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM receipt_analysis_drafts WHERE id = ? AND invalidated = 0 AND finalized = 0)` )
      .bind(transactionId, key, item.normalizedName, JSON.stringify(ratio), draft.source_key, draft.id)];
  });
}

export function invalidateReceiptEvidence(db: LocalDatabase, transactionId: string): LocalStatement[] {
  return [db.prepare("DELETE FROM receipt_corrections WHERE transaction_id = ?").bind(transactionId),
    db.prepare("UPDATE receipt_analysis_drafts SET invalidated = 1 WHERE transaction_id = ?").bind(transactionId)];
}
