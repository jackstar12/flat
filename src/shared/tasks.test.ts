import { describe, expect, it } from "vitest";
import { roommateIds } from "./config";
import {
  addFrequency,
  householdDate,
  scheduledChore,
  completeChore,
  completeRotation,
  currentAssigneeId,
  dateStatus,
  defaultChoreWeekday,
  nextOccurrenceOnOrAfter,
} from "./tasks";
import { weekdays, type Chore, type Rotation } from "./types";

const [first, second, third] = roommateIds;

const baseChore: Chore = {
  id: "chore-1",
  title: "Bad putzen",
  description: "",
  participantIds: [first, second, third],
  rotationIndex: 0,
  frequencyUnit: "week",
  frequencyInterval: 1,
  scheduleWeekday: "wednesday",
  nextDueDate: "2026-05-20",
  lastCompletedAt: null,
  lastCompletedBy: null,
  isActive: true,
  createdBy: first,
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: "2026-05-10T10:00:00.000Z",
};

const baseLaundry: Rotation = {
  id: "laundry",
  title: "Wäsche",
  description: "",
  participantIds: [first, second, third],
  rotationIndex: 0,
  lastCompletedAt: null,
  lastCompletedBy: null,
  createdBy: first,
  createdAt: "2026-05-01T12:00:00.000Z",
  updatedAt: "2026-05-01T12:00:00.000Z",
};

describe("task rules", () => {
  it("returns the current assignee from rotation state", () => {
    expect(currentAssigneeId(baseChore)).toBe(first);
    expect(currentAssigneeId({ ...baseChore, rotationIndex: 4 })).toBe(second);
  });

  it("uses Vienna dates at midnight and daylight-saving boundaries", () => {
    expect(householdDate("2026-10-06T22:30:00Z")).toBe("2026-10-07");
    expect(householdDate("2026-10-27T23:30:00Z")).toBe("2026-10-28");
    const completed = completeChore(baseChore, first, "2026-05-26T22:30:00Z");
    expect(completed.nextDueDate).toBe("2026-06-03");
  });

  it("rotates on scheduled Wednesdays even without completion, including missed weeks", () => {
    const chore = { ...baseChore, nextDueDate: "2026-09-23" };
    expect(scheduledChore(chore, "2026-09-29").rotationIndex).toBe(0);
    expect(scheduledChore(chore, "2026-09-30")).toMatchObject({ rotationIndex: 1, nextDueDate: "2026-09-30", lastCompletedAt: null });
    expect(scheduledChore(chore, "2026-10-07")).toMatchObject({ rotationIndex: 2, nextDueDate: "2026-10-07", lastCompletedAt: null });
    expect(scheduledChore(chore, "2026-10-14").rotationIndex).toBe(0);
    expect(scheduledChore({ ...chore, frequencyInterval: 2 }, "2026-10-07").rotationIndex).toBe(1);
    expect(scheduledChore({ ...chore, isActive: false }, "2026-10-07")).toEqual({ ...chore, isActive: false });
    const completed = completeChore(chore, first, "2026-09-23T10:00:00Z");
    expect(scheduledChore(completed, "2026-09-30").rotationIndex).toBe(1);
    expect(scheduledChore(completed, "2026-10-07").rotationIndex).toBe(2);
  });

  it("defaults chores to Wednesday", () => {
    expect(defaultChoreWeekday).toBe("wednesday");
  });

  it("computes the next occurrence for every weekday", () => {
    expect(weekdays.map((weekday) => nextOccurrenceOnOrAfter("2026-05-18", weekday))).toEqual([
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
      "2026-05-24",
    ]);
  });

  it.each([
    ["early", "2026-05-18T12:00:00.000Z", "2026-05-27"],
    ["on time", "2026-05-20T12:00:00.000Z", "2026-05-27"],
    ["late", "2026-05-22T12:00:00.000Z", "2026-05-27"],
    ["more than a week late", "2026-05-28T12:00:00.000Z", "2026-06-03"],
  ])("keeps the weekly schedule anchored when completed %s", (_label, completedAt, expectedDueDate) => {
    const completed = completeChore(baseChore, first, completedAt);

    expect(completed.rotationIndex).toBe(_label === "more than a week late" ? 2 : 1);
    expect(currentAssigneeId(completed)).toBe(_label === "more than a week late" ? third : second);
    expect(completed.nextDueDate).toBe(expectedDueDate);
    expect(completed.lastCompletedBy).toBe(first);
  });

  it("completion advances a rotation without a due date", () => {
    const completed = completeRotation(baseLaundry, first, "2026-05-17T12:00:00.000Z");

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
