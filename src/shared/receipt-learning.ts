import type { ReceiptAssignmentRule, ReceiptItem, ReceiptSplit } from "./types";

export function normalizeReceiptIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}

// Largest remainder, stable roommate order for ties, also for credits.
export function allocateReceiptRatio(amount: number, weights: number[], ids: string[]): ReceiptSplit[] {
  const total = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map((value) => Math.abs(amount) * value / total);
  const cents = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - cents[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remainder = Math.abs(amount) - cents.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remainder; i++) cents[order[i].index]++;
  return ids.map((roommateId, index) => ({ roommateId, amountCents: cents[index] * Math.sign(amount) }))
    .filter((split) => split.amountCents !== 0);
}

export function canonicalReceiptRatio(item: ReceiptItem, ids: string[]): number[] | null {
  if (!Number.isSafeInteger(item.amountCents) || item.amountCents === 0 ||
      new Set(item.splits.map((s) => s.roommateId)).size !== item.splits.length ||
      item.splits.some((s) => !ids.includes(s.roommateId) || !Number.isSafeInteger(s.amountCents) ||
        (s.amountCents !== 0 && Math.sign(s.amountCents) !== Math.sign(item.amountCents))) ||
      item.splits.reduce((sum, s) => sum + s.amountCents, 0) !== item.amountCents) return null;
  const amounts = ids.map((id) => Math.abs(item.splits.find((s) => s.roommateId === id)?.amountCents ?? 0));
  const positive = amounts.filter((value) => value > 0);
  // Equal shares often differ by one cent. Canonicalize those independently of
  // which person received that cent; tiny zero shares remain real exclusions.
  const weights = Math.max(...positive) - Math.min(...positive) <= 1 && Math.min(...positive) > 1
    ? amounts.map((value) => value > 0 ? 1 : 0) : amounts;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = weights.reduce(gcd, 0);
  return weights.map((weight) => weight / divisor);
}

export function sameReceiptSplits(a: ReceiptItem, b: ReceiptItem, ids: string[]): boolean {
  return ids.every((id) => (a.splits.find((s) => s.roommateId === id)?.amountCents ?? 0) ===
    (b.splits.find((s) => s.roommateId === id)?.amountCents ?? 0));
}

export function matchingReceiptRule(item: Pick<ReceiptItem, "name" | "normalizedName" | "category">, rules: ReceiptAssignmentRule[]) {
  const names = [item.name, item.normalizedName].map(normalizeReceiptIdentity);
  // Literal phrase matches are deterministic. Semantic variants still rely on
  // the model and its prompt; category rules also outrank learned preferences.
  const items = rules.filter((rule) => rule.target === "item" && names.some((name) => {
    const match = normalizeReceiptIdentity(rule.match);
    return match && (` ${name} `).includes(` ${match} `);
  })).sort((a, b) => b.match.length - a.match.length || a.id.localeCompare(b.id));
  return items[0] ?? rules.find((rule) => rule.target === "category" &&
    normalizeReceiptIdentity(rule.match) === normalizeReceiptIdentity(item.category));
}
