import { describe, expect, it } from "vitest";
import { roommateIds } from "./config";
import { addFrequency, completeChore, completeLaundryRotation, currentAssigneeId, dateStatus } from "./tasks";
import type { Chore, LaundryRotation } from "./types";

const [first, second, third] = roommateIds;

const baseChore: Chore = {
  id: "chore-1",
  title: "Bad putzen",
  description: "",
  participantIds: [first, second, third],
  rotationIndex: 0,
  frequencyUnit: "week",
  frequencyInterval: 1,
  nextDueDate: "2026-05-17",
  lastCompletedAt: null,
  lastCompletedBy: null,
  isActive: true,
  createdBy: first,
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: "2026-05-10T10:00:00.000Z",
};

const baseLaundry: LaundryRotation = {
  participantIds: [first, second, third],
  rotationIndex: 0,
  lastCompletedAt: null,
  lastCompletedBy: null,
  updatedAt: null,
};

describe("task rules", () => {
  it("returns the current assignee from rotation state", () => {
    expect(currentAssigneeId(baseChore)).toBe(first);
    expect(currentAssigneeId({ ...baseChore, rotationIndex: 4 })).toBe(second);
  });

  it("completion advances assignee and due date", () => {
    const completed = completeChore(baseChore, first, "2026-05-17T12:00:00.000Z");

    expect(completed.rotationIndex).toBe(1);
    expect(currentAssigneeId(completed)).toBe(second);
    expect(completed.nextDueDate).toBe("2026-05-24");
    expect(completed.lastCompletedBy).toBe(first);
  });

  it("laundry completion advances rotation without a due date", () => {
    const completed = completeLaundryRotation(baseLaundry, first, "2026-05-17T12:00:00.000Z");

    expect(completed.rotationIndex).toBe(1);
    expect(currentAssigneeId(completed)).toBe(second);
    expect(completed.lastCompletedAt).toBe("2026-05-17T12:00:00.000Z");
    expect(completed.lastCompletedBy).toBe(first);
  });

  it("clamps monthly recurrence to the target month", () => {
    expect(addFrequency("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(addFrequency("2026-02-28", "month", 1)).toBe("2026-03-28");
  });

  it("classifies due dates against today", () => {
    expect(dateStatus("2026-05-16", "2026-05-17")).toBe("overdue");
    expect(dateStatus("2026-05-17", "2026-05-17")).toBe("today");
    expect(dateStatus("2026-05-18", "2026-05-17")).toBe("upcoming");
  });
});
