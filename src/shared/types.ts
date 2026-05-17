export type CurrencyCode = "EUR";

export type HouseholdConfig = {
  id: string;
  name: string;
  currency: CurrencyCode;
};

export type Roommate = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export type FinanceTransactionType = "expense" | "settlement";

export type FinanceSplit = {
  roommateId: string;
  owedCents: number;
};

export type FinanceTransaction = {
  id: string;
  type: FinanceTransactionType;
  description: string;
  amountCents: number;
  paidAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  paidBy?: string;
  fromRoommateId?: string;
  toRoommateId?: string;
  splits: FinanceSplit[];
};

export type Balance = {
  roommateId: string;
  balanceCents: number;
};

export type SuggestedSettlement = {
  fromRoommateId: string;
  toRoommateId: string;
  amountCents: number;
};

export type FrequencyUnit = "day" | "week" | "month";

export type Chore = {
  id: string;
  title: string;
  description: string;
  participantIds: string[];
  rotationIndex: number;
  frequencyUnit: FrequencyUnit;
  frequencyInterval: number;
  nextDueDate: string;
  lastCompletedAt: string | null;
  lastCompletedBy: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionPayload = {
  authenticated: boolean;
  roommate: Roommate | null;
  roommates: Roommate[];
  household: HouseholdConfig;
};

export type FinancePayload = {
  transactions: FinanceTransaction[];
  balances: Balance[];
  suggestedSettlements: SuggestedSettlement[];
};

export type TasksPayload = {
  chores: Chore[];
};
