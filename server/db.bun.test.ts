import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "./db";

let database: LocalDatabase | undefined;
let temporaryDirectory: string | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("LocalDatabase", () => {
  test("applies migrations once and supports atomic batches", () => {
    database = new LocalDatabase(":memory:");

    expect(database.migrate()).toEqual(["0001_initial.sql", "0002_chore_weekday.sql"]);
    expect(database.migrate()).toEqual([]);

    database.batch([
      database
        .prepare(
          `INSERT INTO finance_transactions (
            id, household_id, type, description, amount_cents, paid_by,
            from_roommate_id, to_roommate_id, paid_at, created_by, created_at, updated_at
          ) VALUES (?, ?, 'expense', ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
        )
        .bind("tx-1", "flat", "Test", 1200, "jackson", "2026-08-31", "jackson", "now", "now"),
      database
        .prepare("INSERT INTO finance_splits (id, transaction_id, roommate_id, owed_cents) VALUES (?, ?, ?, ?)")
        .bind("split-1", "tx-1", "jackson", 1200),
      database
        .prepare(
          `INSERT INTO finance_receipt_items (
            id, transaction_id, name, quantity, amount_cents, assignment_reason, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind("item-1", "tx-1", "Milch", "1", 1200, "Testregel", 0),
      database
        .prepare(
          `INSERT INTO finance_receipt_item_splits (id, receipt_item_id, roommate_id, amount_cents)
           VALUES (?, ?, ?, ?)`,
        )
        .bind("item-split-1", "item-1", "jackson", 1200),
      database
        .prepare(
          `INSERT INTO finance_receipt_uploads (
             transaction_id, original_name, mime_type, size_bytes, content, uploaded_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind("tx-1", "receipt.pdf", "application/pdf", 4, new Uint8Array([1, 2, 3, 4]), "now"),
    ]);

    expect(database.prepare("SELECT COUNT(*) AS count FROM finance_transactions").first<{ count: number }>()).toEqual({
      count: 1,
    });
    expect(database.prepare("SELECT name FROM finance_receipt_items").first<{ name: string }>()).toEqual({ name: "Milch" });
    expect(database.prepare("SELECT original_name FROM finance_receipt_uploads").first<{ original_name: string }>()).toEqual({
      original_name: "receipt.pdf",
    });
    expect(database.prepare("SELECT title FROM rotations ORDER BY id").all<{ title: string }>().results).toEqual([
      { title: "Pfand" },
      { title: "Wäsche" },
    ]);

    database.prepare("DELETE FROM finance_transactions WHERE id = ?").bind("tx-1").run();
    expect(database.prepare("SELECT COUNT(*) AS count FROM finance_receipt_items").first<{ count: number }>()).toEqual({
      count: 0,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM finance_receipt_uploads").first<{ count: number }>()).toEqual({
      count: 0,
    });
  });

  test("adds Wednesday to weekly chores while preserving intervals, history, and nonweekly schedules", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "flat-migration-"));
    const sourceDirectory = resolve(import.meta.dir, "../migrations");
    copyFileSync(join(sourceDirectory, "0001_initial.sql"), join(temporaryDirectory, "0001_initial.sql"));
    database = new LocalDatabase(join(temporaryDirectory, "flat.sqlite"));
    expect(database.migrate(temporaryDirectory)).toEqual(["0001_initial.sql"]);

    const insert = database.prepare(
      `INSERT INTO chores (
        id, household_id, title, description, participant_ids, rotation_index,
        frequency_unit, frequency_interval, next_due_date, last_completed_at,
        last_completed_by, is_active, created_by, created_at, updated_at
      ) VALUES (?, 'wg-main', ?, '', '["kran"]', 2, ?, ?, ?, ?, 'kran', 1, 'kran', 'created', 'updated')`,
    );
    insert.bind("weekly", "Weekly", "week", 3, "2026-09-06", "2026-08-01T10:00:00Z").run();
    insert.bind("daily", "Daily", "day", 4, "2026-09-07", "2026-08-02T10:00:00Z").run();
    insert.bind("monthly", "Monthly", "month", 2, "2026-09-30", null).run();
    database
      .prepare(
        `INSERT INTO finance_transactions (
          id, household_id, type, description, amount_cents, paid_by,
          from_roommate_id, to_roommate_id, paid_at, created_by, created_at, updated_at
        ) VALUES ('finance-existing', 'wg-main', 'expense', 'Existing expense', 1200, 'kran',
                  NULL, NULL, '2026-09-01', 'kran', 'created', 'updated')`,
      )
      .run();
    const rotationsBefore = database
      .prepare("SELECT id, title FROM rotations ORDER BY id")
      .all<{ id: string; title: string }>().results;

    copyFileSync(join(sourceDirectory, "0002_chore_weekday.sql"), join(temporaryDirectory, "0002_chore_weekday.sql"));
    expect(database.migrate(temporaryDirectory)).toEqual(["0002_chore_weekday.sql"]);

    const rows = database
      .prepare(
        `SELECT id, frequency_unit, frequency_interval, schedule_weekday, next_due_date,
                rotation_index, last_completed_at
         FROM chores ORDER BY id`,
      )
      .all<{
        id: string;
        frequency_unit: string;
        frequency_interval: number;
        schedule_weekday: string | null;
        next_due_date: string;
        rotation_index: number;
        last_completed_at: string | null;
      }>().results;

    expect(rows).toEqual([
      {
        id: "daily",
        frequency_unit: "day",
        frequency_interval: 4,
        schedule_weekday: null,
        next_due_date: "2026-09-07",
        rotation_index: 2,
        last_completed_at: "2026-08-02T10:00:00Z",
      },
      {
        id: "monthly",
        frequency_unit: "month",
        frequency_interval: 2,
        schedule_weekday: null,
        next_due_date: "2026-09-30",
        rotation_index: 2,
        last_completed_at: null,
      },
      {
        id: "weekly",
        frequency_unit: "week",
        frequency_interval: 3,
        schedule_weekday: "wednesday",
        next_due_date: "2026-09-09",
        rotation_index: 2,
        last_completed_at: "2026-08-01T10:00:00Z",
      },
    ]);
    expect(
      database
        .prepare("SELECT description FROM finance_transactions WHERE id = 'finance-existing'")
        .first<{ description: string }>(),
    ).toEqual({ description: "Existing expense" });
    expect(
      database.prepare("SELECT id, title FROM rotations ORDER BY id").all<{ id: string; title: string }>().results,
    ).toEqual(rotationsBefore);
  });
});
