// null means a new form still follows the session; a string is a saved or manual payer.
export function resolveExpensePayer(paidBy: string | null, authenticatedRoommateId?: string | null): string {
  return paidBy ?? authenticatedRoommateId ?? "";
}
