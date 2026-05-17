import type { Chore, FrequencyUnit, LaundryRotation } from "./types";

export function currentAssigneeId(chore: Pick<Chore, "participantIds" | "rotationIndex">): string {
  if (chore.participantIds.length === 0) {
    throw new Error("A chore needs at least one participant.");
  }

  const index = normalizeRotationIndex(chore.rotationIndex, chore.participantIds.length);
  return chore.participantIds[index];
}

export function completeChore(
  chore: Chore,
  completedBy: string,
  completedAtIso: string,
): Chore {
  const completedDate = completedAtIso.slice(0, 10);
  const participantCount = chore.participantIds.length;

  return {
    ...chore,
    rotationIndex: normalizeRotationIndex(chore.rotationIndex + 1, participantCount),
    nextDueDate: addFrequency(completedDate, chore.frequencyUnit, chore.frequencyInterval),
    lastCompletedAt: completedAtIso,
    lastCompletedBy: completedBy,
    updatedAt: completedAtIso,
  };
}

export function completeLaundryRotation(
  rotation: LaundryRotation,
  completedBy: string,
  completedAtIso: string,
): LaundryRotation {
  return {
    ...rotation,
    rotationIndex: normalizeRotationIndex(rotation.rotationIndex + 1, rotation.participantIds.length),
    lastCompletedAt: completedAtIso,
    lastCompletedBy: completedBy,
    updatedAt: completedAtIso,
  };
}

export function addFrequency(
  dateString: string,
  unit: FrequencyUnit,
  interval: number,
): string {
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error("Frequency interval must be a positive integer.");
  }

  const date = parseDateOnly(dateString);

  if (unit === "day") {
    date.setUTCDate(date.getUTCDate() + interval);
    return formatDateOnly(date);
  }

  if (unit === "week") {
    date.setUTCDate(date.getUTCDate() + interval * 7);
    return formatDateOnly(date);
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonth = month + interval;
  const lastDay = lastDayOfMonthUtc(year, targetMonth);
  const target = new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay)));
  return formatDateOnly(target);
}

export function dateStatus(dateString: string, todayString: string): "overdue" | "today" | "upcoming" {
  if (dateString < todayString) {
    return "overdue";
  }
  if (dateString === todayString) {
    return "today";
  }
  return "upcoming";
}

function normalizeRotationIndex(index: number, participantCount: number): number {
  if (participantCount <= 0) {
    throw new Error("Participant count must be positive.");
  }
  return ((index % participantCount) + participantCount) % participantCount;
}

function parseDateOnly(dateString: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    throw new Error("Date must use YYYY-MM-DD format.");
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonthUtc(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}
