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
  receiptItems?: ReceiptItem[];
  receiptSourceRef?: string;
  receiptUpload?: ReceiptUpload;
};

export type ReceiptUpload = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
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

export type ReceiptSplit = {
  roommateId: string;
  amountCents: number;
};

export type ReceiptItem = {
  name: string;
  normalizedName: string;
  category: ReceiptTrackingCategory;
  quantity: string | null;
  amountCents: number;
  assignmentReason: string;
  splits: ReceiptSplit[];
};

export const receiptTrackingCategories = [
  "Eier",
  "Obst",
  "Beeren",
  "Gemüse",
  "Milchprodukte",
  "Fleisch & Wurst",
  "Fisch",
  "Brot & Gebäck",
  "Getreide & Frühstück",
  "Nüsse & Snacks",
  "Aufstriche & Honig",
  "Öle & Gewürze",
  "Getränke",
  "Haushalt",
  "Pfand & Rabatte",
  "Sonstiges",
] as const;

export type ReceiptTrackingCategory = (typeof receiptTrackingCategories)[number];

export type ReceiptAnalysis = {
  merchant: string | null;
  receiptDate: string | null;
  totalCents: number;
  items: ReceiptItem[];
  roommateTotals: ReceiptSplit[];
  warnings: string[];
};

export type ReceiptAssignmentRuleTarget = "category" | "item";

export type ReceiptAssignmentRule = {
  id: string;
  target: ReceiptAssignmentRuleTarget;
  match: string;
  shares: Record<string, number>;
  extraDescription: string | null;
};

export type FrequencyUnit = "day" | "week" | "month";

export const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof weekdays)[number];

export type Chore = {
  id: string;
  title: string;
  description: string;
  participantIds: string[];
  rotationIndex: number;
  frequencyUnit: FrequencyUnit;
  frequencyInterval: number;
  scheduleWeekday: Weekday | null;
  nextDueDate: string;
  lastCompletedAt: string | null;
  lastCompletedBy: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Rotation = {
  id: string;
  title: string;
  description: string;
  participantIds: string[];
  rotationIndex: number;
  lastCompletedAt: string | null;
  lastCompletedBy: string | null;
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
  rotations: Rotation[];
};
