import { describe, expect, it } from "vitest";
import { roommateIds } from "./config";
import { normalizeReceiptAnalysis } from "./receipt";

describe("receipt analysis normalization", () => {
  it("aggregates item splits into roommate totals", () => {
    const [first, second] = roommateIds;
    const analysis = normalizeReceiptAnalysis(
      {
        merchant: "SPAR",
        receiptDate: "2026-05-17",
        warnings: [],
        items: [
          {
            name: "Eier",
            quantity: "1",
            amountCents: 300,
            assignmentReason: "equal split",
            splits: [
              { roommateId: first, amountCents: 150 },
              { roommateId: second, amountCents: 150 },
            ],
          },
          {
            name: "Kase",
            quantity: null,
            amountCents: 250,
            assignmentReason: "matched rule",
            splits: [{ roommateId: second, amountCents: 250 }],
          },
        ],
      },
      roommateIds,
    );

    expect(analysis.totalCents).toBe(550);
    expect(analysis.roommateTotals).toContainEqual({ roommateId: first, amountCents: 150 });
    expect(analysis.roommateTotals).toContainEqual({ roommateId: second, amountCents: 400 });
  });

  it("falls back to equal split when item splits do not match the item amount", () => {
    const analysis = normalizeReceiptAnalysis(
      {
        merchant: null,
        receiptDate: null,
        warnings: [],
        items: [
          {
            name: "Bier",
            quantity: null,
            amountCents: 1000,
            assignmentReason: "bad model math",
            splits: [{ roommateId: roommateIds[0], amountCents: 999 }],
          },
        ],
      },
      roommateIds,
    );

    expect(analysis.totalCents).toBe(1000);
    expect(analysis.roommateTotals.reduce((total, split) => total + split.amountCents, 0)).toBe(1000);
    expect(analysis.warnings.join(" ")).toContain("gleich geteilt");
  });
});
