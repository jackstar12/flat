import { splitEvenly } from "./finance";
import { receiptTrackingCategories } from "./types";
import type { ReceiptAnalysis, ReceiptItem, ReceiptSplit, ReceiptTrackingCategory } from "./types";

export function normalizeReceiptAnalysis(
  raw: unknown,
  stableRoommateOrder: string[],
): ReceiptAnalysis {
  const source = asRecord(raw);
  const warnings: string[] = [];
  const items = Array.isArray(source.items)
    ? source.items
        .map((item, index) => normalizeReceiptItem(item, index, stableRoommateOrder, warnings))
        .filter((item): item is ReceiptItem => Boolean(item))
    : [];

  if (items.length === 0) {
    warnings.push("Keine plausiblen Rechnungspositionen erkannt.");
  }

  const roommateTotals = aggregateReceiptSplits(items, stableRoommateOrder);

  return {
    merchant: normalizeNullableString(source.merchant),
    receiptDate: normalizeDate(source.receiptDate),
    totalCents: items.reduce((total, item) => total + item.amountCents, 0),
    items,
    roommateTotals,
    warnings: [...warnings, ...normalizeWarnings(source.warnings)],
  };
}

export function aggregateReceiptSplits(
  items: ReceiptItem[],
  stableRoommateOrder: string[],
): ReceiptSplit[] {
  const totals = new Map(stableRoommateOrder.map((roommateId) => [roommateId, 0]));

  for (const item of items) {
    for (const split of item.splits) {
      totals.set(split.roommateId, (totals.get(split.roommateId) ?? 0) + split.amountCents);
    }
  }

  return stableRoommateOrder
    .map((roommateId) => ({
      roommateId,
      amountCents: totals.get(roommateId) ?? 0,
    }))
    .filter((split) => split.amountCents !== 0);
}

function normalizeReceiptItem(
  rawItem: unknown,
  index: number,
  stableRoommateOrder: string[],
  warnings: string[],
): ReceiptItem | null {
  const item = asRecord(rawItem);
  const amountCents = normalizeNonZeroInteger(item.amountCents);
  if (!amountCents) {
    warnings.push(`Position ${index + 1} ohne gultigen Betrag ignoriert.`);
    return null;
  }

  const proposedSplits = Array.isArray(item.splits)
    ? item.splits
        .map((split) => normalizeReceiptSplit(split, stableRoommateOrder))
        .filter((split): split is ReceiptSplit => Boolean(split))
    : [];
  const assignmentReason = normalizeNullableString(item.assignmentReason) ?? "Equal split";
  const itemName = normalizeName(item.name, index);
  const requiresExactEqualSplit =
    /gleichm(?:a|ä|ae)ß?ig/i.test(assignmentReason) ||
    /app[- ]?(?:gutschein|joker)|coupon|pfand|leergut|oliven(?:ö|oe)l|darbo natur|lovely topa|m(?:ü|ue|u)llsack|waschmittel/i.test(
      itemName,
    );

  const splits =
    requiresExactEqualSplit
      ? splitSignedEvenly(amountCents, stableRoommateOrder)
      : proposedSplits.length > 0 && sumReceiptSplitCents(proposedSplits) === amountCents
      ? orderSplits(proposedSplits, stableRoommateOrder)
      : splitSignedEvenly(amountCents, stableRoommateOrder);

  if (proposedSplits.length > 0 && sumReceiptSplitCents(proposedSplits) !== amountCents) {
    warnings.push(`Position "${normalizeName(item.name, index)}" wurde wegen unpassender Anteile gleich geteilt.`);
  }

  return {
    name: itemName,
    normalizedName: normalizeNullableString(item.normalizedName) ?? itemName,
    category: normalizeTrackingCategory(item.category),
    quantity: normalizeNullableString(item.quantity),
    amountCents,
    assignmentReason,
    splits,
  };
}

function normalizeTrackingCategory(value: unknown): ReceiptTrackingCategory {
  return typeof value === "string" && receiptTrackingCategories.includes(value as ReceiptTrackingCategory)
    ? (value as ReceiptTrackingCategory)
    : "Sonstiges";
}

function normalizeReceiptSplit(rawSplit: unknown, stableRoommateOrder: string[]): ReceiptSplit | null {
  const split = asRecord(rawSplit);
  const roommateId = typeof split.roommateId === "string" ? split.roommateId : "";
  const amountCents = normalizeInteger(split.amountCents);

  if (!stableRoommateOrder.includes(roommateId) || amountCents === null) {
    return null;
  }

  return { roommateId, amountCents };
}

function orderSplits(splits: ReceiptSplit[], stableRoommateOrder: string[]): ReceiptSplit[] {
  const byRoommate = new Map<string, number>();
  for (const split of splits) {
    byRoommate.set(split.roommateId, (byRoommate.get(split.roommateId) ?? 0) + split.amountCents);
  }

  return stableRoommateOrder
    .map((roommateId) => ({
      roommateId,
      amountCents: byRoommate.get(roommateId) ?? 0,
    }))
    .filter((split) => split.amountCents !== 0);
}

function sumReceiptSplitCents(splits: ReceiptSplit[]): number {
  return splits.reduce((total, split) => total + split.amountCents, 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeName(value: unknown, index: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : `Position ${index + 1}`;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeNonZeroInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) !== 0 ? Number(value) : null;
}

function normalizeInteger(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function splitSignedEvenly(amountCents: number, stableRoommateOrder: string[]): ReceiptSplit[] {
  const sign = Math.sign(amountCents);
  return splitEvenly(Math.abs(amountCents), stableRoommateOrder, stableRoommateOrder).map((split) => ({
    roommateId: split.roommateId,
    amountCents: split.owedCents * sign,
  }));
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0)
    .map((warning) => warning.trim().slice(0, 300));
}
