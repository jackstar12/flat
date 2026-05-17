import { describe, expect, it } from "vitest";
import { addFrequency, completeChore, currentAssigneeId, dateStatus } from "./tasks";
import type { Chore } from "./types";

const baseChore: Chore = {
  id: "chore-1",
  title: "Bad putzen",
  description: "",
  participantIds: ["anna", "ben", "clara"],
  rotationIndex: 0,
  frequencyUnit: "week",
  frequencyInterval: 1,
  nextDueDate: "2026-05-17",
  lastCompletedAt: null,
  lastCompletedBy: null,
  isActive: true,
  createdBy: "anna",
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: "2026-05-10T10:00:00.000Z",
};

describe("task rules", () => {
  it("returns the current assignee from rotation state", () => {
    expect(currentAssigneeId(baseChore)).toBe("anna");
    expect(currentAssigneeId({ ...baseChore, rotationIndex: 4 })).toBe("ben");
  });

  it("completion advances assignee and due date", () => {
    const completed = completeChore(baseChore, "anna", "2026-05-17T12:00:00.000Z");

    expect(completed.rotationIndex).toBe(1);
    expect(currentAssigneeId(completed)).toBe("ben");
    expect(completed.nextDueDate).toBe("2026-05-24");
    expect(completed.lastCompletedBy).toBe("anna");
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
