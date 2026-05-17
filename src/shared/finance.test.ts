import { describe, expect, it } from "vitest";
import { roommateIds } from "./config";
import { calculateBalances, splitEvenly, suggestSettlements, sumSplitCents } from "./finance";
import type { FinanceTransaction } from "./types";

describe("finance rules", () => {
  it("splits cents evenly with deterministic remainder order", () => {
    const splits = splitEvenly(1000, ["clara", "anna", "ben"], roommateIds);

    expect(splits).toEqual([
      { roommateId: "anna", owedCents: 334 },
      { roommateId: "ben", owedCents: 333 },
      { roommateId: "clara", owedCents: 333 },
    ]);
    expect(sumSplitCents(splits)).toBe(1000);
  });

  it("calculates balances from expenses and settlements", () => {
    const transactions: FinanceTransaction[] = [
      {
        id: "expense-1",
        type: "expense",
        description: "Supermarkt",
        amountCents: 1200,
        paidBy: "anna",
        paidAt: "2026-05-17",
        createdBy: "anna",
        createdAt: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        splits: [
          { roommateId: "anna", owedCents: 400 },
          { roommateId: "ben", owedCents: 400 },
          { roommateId: "clara", owedCents: 400 },
        ],
      },
      {
        id: "settlement-1",
        type: "settlement",
        description: "Ausgleich",
        amountCents: 200,
        fromRoommateId: "ben",
        toRoommateId: "anna",
        paidAt: "2026-05-18",
        createdBy: "ben",
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
        splits: [],
      },
    ];

    expect(calculateBalances(transactions, roommateIds)).toEqual([
      { roommateId: "anna", balanceCents: 600 },
      { roommateId: "ben", balanceCents: -200 },
      { roommateId: "clara", balanceCents: -400 },
      { roommateId: "david", balanceCents: 0 },
    ]);
  });

  it("suggests debtor to creditor settlements", () => {
    const settlements = suggestSettlements([
      { roommateId: "anna", balanceCents: 600 },
      { roommateId: "ben", balanceCents: -200 },
      { roommateId: "clara", balanceCents: -400 },
      { roommateId: "david", balanceCents: 0 },
    ]);

    expect(settlements).toEqual([
      { fromRoommateId: "ben", toRoommateId: "anna", amountCents: 200 },
      { fromRoommateId: "clara", toRoommateId: "anna", amountCents: 400 },
    ]);
  });
});
