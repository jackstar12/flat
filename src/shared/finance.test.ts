import { describe, expect, it } from "vitest";
import { roommateIds } from "./config";
import { calculateBalances, splitEvenly, suggestSettlements, sumSplitCents } from "./finance";
import type { FinanceTransaction } from "./types";

describe("finance rules", () => {
  it("splits cents evenly with deterministic remainder order", () => {
    const [first, second, third] = roommateIds;
    const splits = splitEvenly(1000, [third, first, second], roommateIds);

    expect(splits).toEqual([
      { roommateId: first, owedCents: 334 },
      { roommateId: second, owedCents: 333 },
      { roommateId: third, owedCents: 333 },
    ]);
    expect(sumSplitCents(splits)).toBe(1000);
  });

  it("calculates balances from expenses and settlements", () => {
    const [first, second, third] = roommateIds;
    const transactions: FinanceTransaction[] = [
      {
        id: "expense-1",
        type: "expense",
        description: "Supermarkt",
        amountCents: 1200,
        paidBy: first,
        paidAt: "2026-05-17",
        createdBy: first,
        createdAt: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        splits: [
          { roommateId: first, owedCents: 400 },
          { roommateId: second, owedCents: 400 },
          { roommateId: third, owedCents: 400 },
        ],
      },
      {
        id: "settlement-1",
        type: "settlement",
        description: "Ausgleich",
        amountCents: 200,
        fromRoommateId: second,
        toRoommateId: first,
        paidAt: "2026-05-18",
        createdBy: second,
        createdAt: "2026-05-18T10:00:00.000Z",
        updatedAt: "2026-05-18T10:00:00.000Z",
        splits: [],
      },
    ];

    expect(calculateBalances(transactions, roommateIds)).toEqual(
      roommateIds.map((roommateId) => ({
        roommateId,
        balanceCents:
          roommateId === first ? 600 : roommateId === second ? -200 : roommateId === third ? -400 : 0,
      })),
    );
  });

  it("suggests debtor to creditor settlements", () => {
    const [first, second, third] = roommateIds;
    const settlements = suggestSettlements([
      { roommateId: first, balanceCents: 600 },
      { roommateId: second, balanceCents: -200 },
      { roommateId: third, balanceCents: -400 },
      ...roommateIds.slice(3).map((roommateId) => ({ roommateId, balanceCents: 0 })),
    ]);

    expect(settlements).toEqual([
      { fromRoommateId: second, toRoommateId: first, amountCents: 200 },
      { fromRoommateId: third, toRoommateId: first, amountCents: 400 },
    ]);
  });
});
