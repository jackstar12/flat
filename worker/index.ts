import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { household, roommateIds, roommates, findRoommate } from "../src/shared/config";
import {
  calculateBalances,
  splitEvenly,
  suggestSettlements,
  sumSplitCents,
} from "../src/shared/finance";
import { completeChore } from "../src/shared/tasks";
import type {
  Chore,
  FinanceSplit,
  FinanceTransaction,
  FrequencyUnit,
  Roommate,
} from "../src/shared/types";

type Env = {
  DB: D1Database;
  MAGIC_PASSWORD: string;
  SESSION_SECRET: string;
};

type AppBindings = {
  Bindings: Env;
  Variables: {
    roommate: Roommate;
  };
};

type TransactionRow = {
  id: string;
  type: "expense" | "settlement";
  description: string;
  amount_cents: number;
  paid_by: string | null;
  from_roommate_id: string | null;
  to_roommate_id: string | null;
  paid_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type SplitRow = {
  transaction_id: string;
  roommate_id: string;
  owed_cents: number;
};

type ChoreRow = {
  id: string;
  title: string;
  description: string;
  participant_ids: string;
  rotation_index: number;
  frequency_unit: FrequencyUnit;
  frequency_interval: number;
  next_due_date: string;
  last_completed_at: string | null;
  last_completed_by: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const sessionCookieName = "flat_session";
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roommateIdSchema = z.string().refine((value) => roommateIds.includes(value), {
  message: "Unbekannte Person.",
});

const loginSchema = z.object({
  roommateId: roommateIdSchema,
  password: z.string().min(1),
});

const splitSchema = z.object({
  roommateId: roommateIdSchema,
  owedCents: z.number().int().min(0),
});

const expenseSchema = z
  .object({
    description: z.string().trim().min(1).max(100),
    amountCents: z.number().int().positive(),
    paidBy: roommateIdSchema,
    paidAt: dateSchema,
    splitMode: z.enum(["equal", "custom"]),
    participantIds: z.array(roommateIdSchema).default([]),
    splits: z.array(splitSchema).default([]),
  })
  .superRefine((value, context) => {
    if (value.splitMode === "equal" && value.participantIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["participantIds"],
        message: "Mindestens eine Person muss ausgewahlt sein.",
      });
    }
    if (value.splitMode === "custom" && value.splits.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["splits"],
        message: "Mindestens ein Anteil ist erforderlich.",
      });
    }
  });

const settlementSchema = z
  .object({
    amountCents: z.number().int().positive(),
    fromRoommateId: roommateIdSchema,
    toRoommateId: roommateIdSchema,
    paidAt: dateSchema,
    description: z.string().trim().max(100).optional(),
  })
  .refine((value) => value.fromRoommateId !== value.toRoommateId, {
    message: "Sender und Empfanger mussen unterschiedlich sein.",
    path: ["toRoommateId"],
  });

const choreSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  participantIds: z.array(roommateIdSchema).min(1),
  frequencyUnit: z.enum(["day", "week", "month"]),
  frequencyInterval: z.number().int().positive().max(36),
  nextDueDate: dateSchema,
  isActive: z.boolean().default(true),
});

const app = new Hono<AppBindings>();

app.get("/api/session", async (c) => {
  const roommate = await readSession(c.req.raw, c.env.SESSION_SECRET);
  return c.json({
    authenticated: Boolean(roommate),
    roommate,
    roommates,
    household,
  });
});

app.post("/api/login", zValidator("json", loginSchema), async (c) => {
  const input = c.req.valid("json");

  if (input.password !== c.env.MAGIC_PASSWORD) {
    return c.json({ error: "Das Passwort stimmt nicht." }, 401);
  }

  const roommate = findRoommate(input.roommateId);
  if (!roommate) {
    return c.json({ error: "Unbekannte Person." }, 400);
  }

  const maxAgeSeconds = 60 * 60 * 24 * 30;
  const expiresAt = Date.now() + maxAgeSeconds * 1000;
  const value = await createSessionValue(roommate.id, expiresAt, c.env.SESSION_SECRET);

  setCookie(c, sessionCookieName, value, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: maxAgeSeconds,
  });

  return c.json({
    authenticated: true,
    roommate,
    roommates,
    household,
  });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, sessionCookieName, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  const roommate = await readSession(c.req.raw, c.env.SESSION_SECRET);
  if (!roommate) {
    return c.json({ error: "Nicht angemeldet." }, 401);
  }
  c.set("roommate", roommate);
  await next();
});

app.get("/api/finance", async (c) => {
  const transactions = await listFinanceTransactions(c.env.DB);
  const balances = calculateBalances(transactions, roommateIds);

  return c.json({
    transactions,
    balances,
    suggestedSettlements: suggestSettlements(balances),
  });
});

app.post("/api/finance/expenses", zValidator("json", expenseSchema), async (c) => {
  const input = c.req.valid("json");
  const splits = buildExpenseSplits(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const actor = c.get("roommate");

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO finance_transactions (
          id, household_id, type, description, amount_cents, paid_by,
          from_roommate_id, to_roommate_id, paid_at, created_by, created_at, updated_at
        ) VALUES (?, ?, 'expense', ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        household.id,
        input.description,
        input.amountCents,
        input.paidBy,
        input.paidAt,
        actor.id,
        now,
        now,
      ),
    ...splits.map((split) =>
      c.env.DB
        .prepare(
          `INSERT INTO finance_splits (id, transaction_id, roommate_id, owed_cents)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, split.roommateId, split.owedCents),
    ),
  ]);

  return c.json({ transaction: await getTransaction(c.env.DB, id) }, 201);
});

app.patch("/api/finance/expenses/:id", zValidator("json", expenseSchema), async (c) => {
  const id = c.req.param("id");
  await requireTransaction(c.env.DB, id, "expense");

  const input = c.req.valid("json");
  const splits = buildExpenseSplits(input);
  const now = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE finance_transactions
         SET description = ?, amount_cents = ?, paid_by = ?, paid_at = ?, updated_at = ?
         WHERE id = ? AND household_id = ? AND type = 'expense'`,
      )
      .bind(input.description, input.amountCents, input.paidBy, input.paidAt, now, id, household.id),
    c.env.DB.prepare("DELETE FROM finance_splits WHERE transaction_id = ?").bind(id),
    ...splits.map((split) =>
      c.env.DB
        .prepare(
          `INSERT INTO finance_splits (id, transaction_id, roommate_id, owed_cents)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, split.roommateId, split.owedCents),
    ),
  ]);

  return c.json({ transaction: await getTransaction(c.env.DB, id) });
});

app.delete("/api/finance/expenses/:id", async (c) => {
  const id = c.req.param("id");
  await requireTransaction(c.env.DB, id, "expense");
  await c.env.DB
    .prepare("DELETE FROM finance_transactions WHERE id = ? AND household_id = ? AND type = 'expense'")
    .bind(id, household.id)
    .run();
  return c.json({ ok: true });
});

app.post("/api/finance/settlements", zValidator("json", settlementSchema), async (c) => {
  const input = c.req.valid("json");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const actor = c.get("roommate");
  const from = findRoommate(input.fromRoommateId);
  const to = findRoommate(input.toRoommateId);
  const description = input.description || `Ausgleichszahlung: ${from?.name ?? "?"} an ${to?.name ?? "?"}`;

  await c.env.DB
    .prepare(
      `INSERT INTO finance_transactions (
        id, household_id, type, description, amount_cents, paid_by,
        from_roommate_id, to_roommate_id, paid_at, created_by, created_at, updated_at
      ) VALUES (?, ?, 'settlement', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      household.id,
      description,
      input.amountCents,
      input.fromRoommateId,
      input.toRoommateId,
      input.paidAt,
      actor.id,
      now,
      now,
    )
    .run();

  return c.json({ transaction: await getTransaction(c.env.DB, id) }, 201);
});

app.get("/api/tasks", async (c) => {
  return c.json({ chores: await listChores(c.env.DB) });
});

app.post("/api/tasks", zValidator("json", choreSchema), async (c) => {
  const input = c.req.valid("json");
  const now = new Date().toISOString();
  const actor = c.get("roommate");
  const id = crypto.randomUUID();
  const participants = stableParticipantIds(input.participantIds);

  await c.env.DB
    .prepare(
      `INSERT INTO chores (
        id, household_id, title, description, participant_ids, rotation_index,
        frequency_unit, frequency_interval, next_due_date, last_completed_at,
        last_completed_by, is_active, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      household.id,
      input.title,
      input.description,
      JSON.stringify(participants),
      input.frequencyUnit,
      input.frequencyInterval,
      input.nextDueDate,
      input.isActive ? 1 : 0,
      actor.id,
      now,
      now,
    )
    .run();

  return c.json({ chore: await getChore(c.env.DB, id) }, 201);
});

app.patch("/api/tasks/:id", zValidator("json", choreSchema), async (c) => {
  const id = c.req.param("id");
  const existing = await requireChore(c.env.DB, id);
  const input = c.req.valid("json");
  const now = new Date().toISOString();
  const participants = stableParticipantIds(input.participantIds);
  const rotationIndex = existing.rotationIndex % participants.length;

  await c.env.DB
    .prepare(
      `UPDATE chores
       SET title = ?, description = ?, participant_ids = ?, rotation_index = ?,
           frequency_unit = ?, frequency_interval = ?, next_due_date = ?,
           is_active = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
    .bind(
      input.title,
      input.description,
      JSON.stringify(participants),
      rotationIndex,
      input.frequencyUnit,
      input.frequencyInterval,
      input.nextDueDate,
      input.isActive ? 1 : 0,
      now,
      id,
      household.id,
    )
    .run();

  return c.json({ chore: await getChore(c.env.DB, id) });
});

app.delete("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  await requireChore(c.env.DB, id);
  await c.env.DB.prepare("DELETE FROM chores WHERE id = ? AND household_id = ?").bind(id, household.id).run();
  return c.json({ ok: true });
});

app.post("/api/tasks/:id/complete", async (c) => {
  const id = c.req.param("id");
  const chore = await requireChore(c.env.DB, id);
  if (!chore.isActive) {
    return c.json({ error: "Diese Aufgabe ist deaktiviert." }, 400);
  }

  const actor = c.get("roommate");
  const completedAt = new Date().toISOString();
  const updated = completeChore(chore, actor.id, completedAt);

  await c.env.DB
    .prepare(
      `UPDATE chores
       SET rotation_index = ?, next_due_date = ?, last_completed_at = ?,
           last_completed_by = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
    .bind(
      updated.rotationIndex,
      updated.nextDueDate,
      updated.lastCompletedAt,
      updated.lastCompletedBy,
      updated.updatedAt,
      id,
      household.id,
    )
    .run();

  return c.json({ chore: await getChore(c.env.DB, id) });
});

function buildExpenseSplits(input: z.infer<typeof expenseSchema>): FinanceSplit[] {
  const splits =
    input.splitMode === "equal"
      ? splitEvenly(input.amountCents, input.participantIds, roommateIds)
      : input.splits.filter((split) => split.owedCents > 0);

  const uniqueRoommates = new Set(splits.map((split) => split.roommateId));
  if (uniqueRoommates.size !== splits.length) {
    throw new HTTPError(400, "Jede Person darf nur einen Anteil haben.");
  }
  if (splits.length === 0) {
    throw new HTTPError(400, "Mindestens ein Anteil ist erforderlich.");
  }
  if (sumSplitCents(splits) !== input.amountCents) {
    throw new HTTPError(400, "Die Anteile mussen exakt zur Summe passen.");
  }
  return splits;
}

async function listFinanceTransactions(db: D1Database): Promise<FinanceTransaction[]> {
  const transactionRows = await db
    .prepare(
      `SELECT id, type, description, amount_cents, paid_by, from_roommate_id, to_roommate_id,
              paid_at, created_by, created_at, updated_at
       FROM finance_transactions
       WHERE household_id = ?
       ORDER BY paid_at DESC, created_at DESC`,
    )
    .bind(household.id)
    .all<TransactionRow>();

  const splitRows = await db
    .prepare(
      `SELECT s.transaction_id, s.roommate_id, s.owed_cents
       FROM finance_splits s
       INNER JOIN finance_transactions t ON t.id = s.transaction_id
       WHERE t.household_id = ?
       ORDER BY s.rowid ASC`,
    )
    .bind(household.id)
    .all<SplitRow>();

  const splitsByTransaction = new Map<string, FinanceSplit[]>();
  for (const row of splitRows.results ?? []) {
    const splits = splitsByTransaction.get(row.transaction_id) ?? [];
    splits.push({ roommateId: row.roommate_id, owedCents: row.owed_cents });
    splitsByTransaction.set(row.transaction_id, splits);
  }

  return (transactionRows.results ?? []).map((row) => mapTransaction(row, splitsByTransaction.get(row.id) ?? []));
}

async function getTransaction(db: D1Database, id: string): Promise<FinanceTransaction> {
  const row = await db
    .prepare(
      `SELECT id, type, description, amount_cents, paid_by, from_roommate_id, to_roommate_id,
              paid_at, created_by, created_at, updated_at
       FROM finance_transactions
       WHERE id = ? AND household_id = ?`,
    )
    .bind(id, household.id)
    .first<TransactionRow>();

  if (!row) {
    throw new HTTPError(404, "Eintrag nicht gefunden.");
  }

  const splitRows = await db
    .prepare(
      `SELECT transaction_id, roommate_id, owed_cents
       FROM finance_splits
       WHERE transaction_id = ?
       ORDER BY rowid ASC`,
    )
    .bind(id)
    .all<SplitRow>();

  return mapTransaction(
    row,
    (splitRows.results ?? []).map((split) => ({
      roommateId: split.roommate_id,
      owedCents: split.owed_cents,
    })),
  );
}

async function requireTransaction(
  db: D1Database,
  id: string,
  type: "expense" | "settlement",
): Promise<void> {
  const row = await db
    .prepare("SELECT id FROM finance_transactions WHERE id = ? AND household_id = ? AND type = ?")
    .bind(id, household.id, type)
    .first<{ id: string }>();
  if (!row) {
    throw new HTTPError(404, "Eintrag nicht gefunden.");
  }
}

function mapTransaction(row: TransactionRow, splits: FinanceSplit[]): FinanceTransaction {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidBy: row.paid_by ?? undefined,
    fromRoommateId: row.from_roommate_id ?? undefined,
    toRoommateId: row.to_roommate_id ?? undefined,
    splits,
  };
}

async function listChores(db: D1Database): Promise<Chore[]> {
  const rows = await db
    .prepare(
      `SELECT id, title, description, participant_ids, rotation_index,
              frequency_unit, frequency_interval, next_due_date,
              last_completed_at, last_completed_by, is_active,
              created_by, created_at, updated_at
       FROM chores
       WHERE household_id = ?
       ORDER BY is_active DESC, next_due_date ASC, created_at DESC`,
    )
    .bind(household.id)
    .all<ChoreRow>();

  return (rows.results ?? []).map(mapChore);
}

async function getChore(db: D1Database, id: string): Promise<Chore> {
  const row = await db
    .prepare(
      `SELECT id, title, description, participant_ids, rotation_index,
              frequency_unit, frequency_interval, next_due_date,
              last_completed_at, last_completed_by, is_active,
              created_by, created_at, updated_at
       FROM chores
       WHERE id = ? AND household_id = ?`,
    )
    .bind(id, household.id)
    .first<ChoreRow>();

  if (!row) {
    throw new HTTPError(404, "Aufgabe nicht gefunden.");
  }

  return mapChore(row);
}

async function requireChore(db: D1Database, id: string): Promise<Chore> {
  return getChore(db, id);
}

function mapChore(row: ChoreRow): Chore {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    participantIds: JSON.parse(row.participant_ids) as string[],
    rotationIndex: row.rotation_index,
    frequencyUnit: row.frequency_unit,
    frequencyInterval: row.frequency_interval,
    nextDueDate: row.next_due_date,
    lastCompletedAt: row.last_completed_at,
    lastCompletedBy: row.last_completed_by,
    isActive: Boolean(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stableParticipantIds(input: string[]): string[] {
  const selected = new Set(input);
  return roommateIds.filter((roommateId) => selected.has(roommateId));
}

async function readSession(request: Request, secret: string): Promise<Roommate | null> {
  const cookieHeader = request.headers.get("Cookie");
  const value = readCookie(cookieHeader, sessionCookieName);
  if (!value) {
    return null;
  }

  const parts = value.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [roommateId, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  const expected = await signSession(`${roommateId}.${expiresAtRaw}`, secret);
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  return findRoommate(roommateId) ?? null;
}

async function createSessionValue(roommateId: string, expiresAt: number, secret: string): Promise<string> {
  const payload = `${roommateId}.${expiresAt}`;
  return `${payload}.${await signSession(payload, secret)}`;
}

async function signSession(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(signature);
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const prefix = `${name}=`;
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

class HTTPError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

app.onError((error, c) => {
  if (error instanceof HTTPError) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "Unerwarteter Serverfehler." }, 500);
});

export default app;
