import type {
  Balance,
  FinanceSplit,
  FinanceTransaction,
  SuggestedSettlement,
} from "./types";

export function splitEvenly(
  amountCents: number,
  selectedRoommateIds: string[],
  stableRoommateOrder: string[],
): FinanceSplit[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Amount must be a positive integer number of cents.");
  }

  const uniqueSelected = stableRoommateOrder.filter((roommateId) =>
    selectedRoommateIds.includes(roommateId),
  );

  if (uniqueSelected.length === 0) {
    throw new Error("At least one roommate must be selected.");
  }

  const base = Math.floor(amountCents / uniqueSelected.length);
  let remainder = amountCents % uniqueSelected.length;

  return uniqueSelected.map((roommateId) => {
    const owedCents = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return { roommateId, owedCents };
  });
}

export function sumSplitCents(splits: FinanceSplit[]): number {
  return splits.reduce((total, split) => total + split.owedCents, 0);
}

export function calculateBalances(
  transactions: FinanceTransaction[],
  stableRoommateOrder: string[],
): Balance[] {
  const balances = new Map<string, number>();
  stableRoommateOrder.forEach((roommateId) => balances.set(roommateId, 0));

  for (const transaction of transactions) {
    if (transaction.type === "expense") {
      if (!transaction.paidBy) {
        continue;
      }
      balances.set(
        transaction.paidBy,
        (balances.get(transaction.paidBy) ?? 0) + transaction.amountCents,
      );
      for (const split of transaction.splits) {
        balances.set(
          split.roommateId,
          (balances.get(split.roommateId) ?? 0) - split.owedCents,
        );
      }
      continue;
    }

    if (transaction.fromRoommateId && transaction.toRoommateId) {
      balances.set(
        transaction.fromRoommateId,
        (balances.get(transaction.fromRoommateId) ?? 0) + transaction.amountCents,
      );
      balances.set(
        transaction.toRoommateId,
        (balances.get(transaction.toRoommateId) ?? 0) - transaction.amountCents,
      );
    }
  }

  return stableRoommateOrder.map((roommateId) => ({
    roommateId,
    balanceCents: balances.get(roommateId) ?? 0,
  }));
}

export function suggestSettlements(balances: Balance[]): SuggestedSettlement[] {
  const debtors = balances
    .filter((balance) => balance.balanceCents < 0)
    .map((balance) => ({
      roommateId: balance.roommateId,
      amountCents: Math.abs(balance.balanceCents),
    }));
  const creditors = balances
    .filter((balance) => balance.balanceCents > 0)
    .map((balance) => ({
      roommateId: balance.roommateId,
      amountCents: balance.balanceCents,
    }));

  const settlements: SuggestedSettlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.amountCents, creditor.amountCents);

    if (amountCents > 0) {
      settlements.push({
        fromRoommateId: debtor.roommateId,
        toRoommateId: creditor.roommateId,
        amountCents,
      });
    }

    debtor.amountCents -= amountCents;
    creditor.amountCents -= amountCents;

    if (debtor.amountCents === 0) {
      debtorIndex += 1;
    }
    if (creditor.amountCents === 0) {
      creditorIndex += 1;
    }
  }

  return settlements;
}
