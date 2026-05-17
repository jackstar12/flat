export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${dateString}T00:00:00Z`));
}

export function centsFromEuroInput(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return Number.NaN;
  }
  return Math.round(Number(normalized) * 100);
}

export function euroInputFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
