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

  it("accepts exact allocations containing zero-percent roommates", () => {
    const analysis = normalizeReceiptAnalysis(
      {
        merchant: "SPAR",
        receiptDate: "2026-01-20",
        warnings: [],
        items: [
          {
            name: "Beeren",
            quantity: "1",
            amountCents: 599,
            assignmentReason: "50/50/0 rule",
            splits: [
              { roommateId: roommateIds[0], amountCents: 300 },
              { roommateId: roommateIds[1], amountCents: 299 },
              { roommateId: roommateIds[2], amountCents: 0 },
            ],
          },
        ],
      },
      roommateIds,
    );

    expect(analysis.warnings).toEqual([]);
    expect(analysis.items[0].splits).toEqual([
      { roommateId: roommateIds[0], amountCents: 300 },
      { roommateId: roommateIds[1], amountCents: 299 },
    ]);
  });

  it("preserves returned deposits as signed positions and splits", () => {
    const analysis = normalizeReceiptAnalysis(
      {
        merchant: "SPAR",
        receiptDate: "2026-03-13",
        warnings: [],
        items: [
          {
            name: "Einkauf",
            quantity: null,
            amountCents: 3413,
            assignmentReason: "Regeln angewendet",
            splits: [{ roommateId: roommateIds[0], amountCents: 3413 }],
          },
          {
            name: "Leergut-Gutschrift",
            quantity: null,
            amountCents: -3000,
            assignmentReason: "Gutschrift gleich geteilt",
            splits: [
              { roommateId: roommateIds[0], amountCents: -1000 },
              { roommateId: roommateIds[1], amountCents: -1000 },
              { roommateId: roommateIds[2], amountCents: -1000 },
            ],
          },
        ],
      },
      roommateIds,
    );

    expect(analysis.totalCents).toBe(413);
    expect(analysis.items[1].amountCents).toBe(-3000);
    expect(analysis.roommateTotals.reduce((total, split) => total + split.amountCents, 0)).toBe(413);
  });

  it("enforces cent-exact equal splits when the assignment reason says equally", () => {
    const analysis = normalizeReceiptAnalysis(
      {
        items: [
          {
            name: "Olivenöl",
            quantity: null,
            amountCents: 1099,
            assignmentReason: "Centgenau gleichmäßig geteilt.",
            splits: [
              { roommateId: roommateIds[0], amountCents: 363 },
              { roommateId: roommateIds[1], amountCents: 363 },
              { roommateId: roommateIds[2], amountCents: 373 },
            ],
          },
        ],
      },
      roommateIds,
    );

    expect(analysis.items[0].splits).toEqual([
      { roommateId: roommateIds[0], amountCents: 367 },
      { roommateId: roommateIds[1], amountCents: 366 },
      { roommateId: roommateIds[2], amountCents: 366 },
    ]);
  });

  it("enforces equal coupon splits even when the model omits that wording", () => {
    const analysis = normalizeReceiptAnalysis(
      {
        items: [
          {
            name: "App-Gutschein",
            quantity: null,
            amountCents: -300,
            assignmentReason: "Artikelregel App-Gutschein",
            splits: [
              { roommateId: roommateIds[0], amountCents: -99 },
              { roommateId: roommateIds[1], amountCents: -99 },
              { roommateId: roommateIds[2], amountCents: -102 },
            ],
          },
        ],
      },
      roommateIds,
    );

    expect(analysis.items[0].splits).toEqual([
      { roommateId: roommateIds[0], amountCents: -100 },
      { roommateId: roommateIds[1], amountCents: -100 },
      { roommateId: roommateIds[2], amountCents: -100 },
    ]);
  });
});
