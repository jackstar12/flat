import { hasProxyProof, isHealthRequest } from "./proxy";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { analyzeReceiptWithCodex } from "./codex";
import type { LocalDatabase } from "./db";
import { household, roommateIds, roommates, findRoommate } from "../src/shared/config";
import {
  calculateBalances,
  splitEvenly,
  suggestSettlements,
  sumSplitCents,
} from "../src/shared/finance";
import { normalizeReceiptAnalysis } from "../src/shared/receipt";
import {
  completeChore,
  completeRotation,
  defaultChoreWeekday,
  nextOccurrenceOnOrAfter,
} from "../src/shared/tasks";
import type {
  Chore,
  FinanceSplit,
  FinanceTransaction,
  FrequencyUnit,
  Rotation,
  ReceiptAssignmentRule,
  ReceiptItem,
  Roommate,
  Weekday,
} from "../src/shared/types";
import { receiptTrackingCategories, weekdays } from "../src/shared/types";

type Env = {
  DB: LocalDatabase;
  PROXY_TOKEN: string;
  SESSION_SECRET: string;
  TRUSTED_ORIGINS: readonly string[];
  analyzeReceipt: typeof analyzeReceiptWithCodex;
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
  receipt_source_ref: string | null;
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
  schedule_weekday: Weekday | null;
  next_due_date: string;
  last_completed_at: string | null;
  last_completed_by: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type RotationRow = {
  id: string;
  title: string;
  description: string;
  participant_ids: string;
  rotation_index: number;
  last_completed_at: string | null;
  last_completed_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ReceiptAssignmentRuleRow = {
  id: string;
  target: "category" | "item";
  match: string;
  shares: string;
  extra_description: string | null;
};

type ReceiptItemRow = {
  id: string;
  transaction_id: string;
  name: string;
  normalized_name: string;
  category: ReceiptItem["category"];
  quantity: string | null;
  amount_cents: number;
  assignment_reason: string;
};

type ReceiptItemSplitRow = {
  receipt_item_id: string;
  roommate_id: string;
  amount_cents: number;
};

type ReceiptUploadRow = {
  transaction_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
};

type ReceiptUploadContentRow = ReceiptUploadRow & {
  content: Uint8Array;
};

const sessionCookieName = "flat_session";
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roommateIdSchema = z.string().refine((value) => roommateIds.includes(value), {
  message: "Unbekannte Person.",
});

const loginSchema = z.object({
  roommateId: roommateIdSchema,
});

const splitSchema = z.object({
  roommateId: roommateIdSchema,
  owedCents: z.number().int(),
});

const receiptItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    normalizedName: z.string().trim().min(1).max(120).optional(),
    category: z.enum(receiptTrackingCategories).optional(),
    quantity: z.string().trim().max(100).nullable(),
    amountCents: z.number().int().refine((amount) => amount !== 0, "Positionsbetrag darf nicht null sein."),
    assignmentReason: z.string().trim().min(1).max(500),
    splits: z.array(
      z.object({
        roommateId: roommateIdSchema,
        amountCents: z.number().int(),
      }),
    ),
  })
  .superRefine((item, context) => {
    const roommateIdsInSplits = item.splits.map((split) => split.roommateId);
    if (new Set(roommateIdsInSplits).size !== roommateIdsInSplits.length) {
      context.addIssue({ code: "custom", path: ["splits"], message: "Personen durfen pro Position nur einmal vorkommen." });
    }
    if (item.splits.reduce((sum, split) => sum + split.amountCents, 0) !== item.amountCents) {
      context.addIssue({ code: "custom", path: ["splits"], message: "Die Positionsanteile mussen dem Positionsbetrag entsprechen." });
    }
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
    receiptItems: z.array(receiptItemSchema).max(500).optional(),
    receiptSourceRef: z.string().trim().min(1).max(120).optional(),
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
    if (
      value.receiptItems?.length &&
      value.receiptItems.reduce((sum, item) => sum + item.amountCents, 0) !== value.amountCents
    ) {
      context.addIssue({
        code: "custom",
        path: ["receiptItems"],
        message: "Die Positionen mussen zusammen dem Rechnungsbetrag entsprechen.",
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

const choreFields = {
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  participantIds: z.array(roommateIdSchema).min(1),
  frequencyInterval: z.number().int().positive().max(36).default(1),
  isActive: z.boolean().default(true),
};
const choreCreateSchema = z.object({
  ...choreFields,
  scheduleWeekday: z.enum(weekdays).default(defaultChoreWeekday),
});
const choreUpdateSchema = z.object({
  ...choreFields,
  scheduleWeekday: z.enum(weekdays).nullable().optional(),
});

const rotationSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  participantIds: z.array(roommateIdSchema).min(1),
});

const receiptAssignmentRuleSchema = z.object({
  id: z.string().min(1).max(100),
  target: z.enum(["category", "item"]),
  match: z.string().trim().min(1).max(100),
  shares: z
    .object({
      kran: z.number().int().min(0).max(100),
      stadlmann: z.number().int().min(0).max(100),
      mitter: z.number().int().min(0).max(100),
    })
    .refine((shares) => Object.values(shares).reduce((sum, value) => sum + value, 0) === 100, {
      message: "Die Anteile einer Regel mussen zusammen 100% ergeben.",
    }),
  extraDescription: z.string().trim().max(500).nullable(),
});

const receiptAssignmentRulesSchema = z
  .object({ rules: z.array(receiptAssignmentRuleSchema).max(100) })
  .superRefine(({ rules }, context) => {
    const identities = new Set<string>();
    rules.forEach((rule, index) => {
      const identity = `${rule.target}:${rule.match.toLocaleLowerCase("de")}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["rules", index, "match"],
          message: "Diese Regel existiert bereits.",
        });
      }
      identities.add(identity);
    });
  });

const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
  if (!isHealthRequest(c.req.raw) && !hasProxyProof(c.req.raw, c.env.PROXY_TOKEN)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// One constant-size budget for the entire process, independent of proxy/IP headers.
const loginWindowMs = 15 * 60 * 1000;
const loginAttemptLimit = 30;
let loginWindowStartedAt = 0;
let loginAttempts = 0;

app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (!origin || !c.env.TRUSTED_ORIGINS.includes(origin)) {
      return c.json({ error: "Nicht erlaubter Origin." }, 403);
    }
  }
  await next();
});

app.use("/api/login", async (c, next) => {
  if (c.req.method === "POST") {
    const now = Date.now();
    if (now - loginWindowStartedAt >= loginWindowMs) {
      loginWindowStartedAt = now;
      loginAttempts = 0;
    }
    if (loginAttempts >= loginAttemptLimit) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((loginWindowStartedAt + loginWindowMs - now) / 1000))));
      return c.json({ error: "Zu viele Anmeldeversuche. Bitte spater erneut versuchen." }, 429);
    }
    loginAttempts++;
  }
  await next();
});

app.get("/healthz", (c) => c.json({ ok: true }));

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
    secure: c.req.header("Origin")!.startsWith("https://"),
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
  deleteCookie(c, sessionCookieName, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: c.req.header("Origin")!.startsWith("https://"),
  });
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
  const receiptItems = (input.receiptItems ?? []).map((item) => ({ id: crypto.randomUUID(), item }));

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO finance_transactions (
          id, household_id, type, description, amount_cents, paid_by,
          from_roommate_id, to_roommate_id, paid_at, created_by, created_at, updated_at,
          receipt_source_ref
        ) VALUES (?, ?, 'expense', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
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
        input.receiptSourceRef ?? null,
      ),
    ...splits.map((split) =>
      c.env.DB
        .prepare(
          `INSERT INTO finance_splits (id, transaction_id, roommate_id, owed_cents)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, split.roommateId, split.owedCents),
    ),
    ...receiptItems.flatMap(({ id: receiptItemId, item }, sortOrder) => [
      c.env.DB
        .prepare(
          `INSERT INTO finance_receipt_items (
            id, transaction_id, name, normalized_name, category, quantity,
            amount_cents, assignment_reason, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          receiptItemId,
          id,
          item.name,
          item.normalizedName ?? item.name,
          item.category ?? "Sonstiges",
          item.quantity,
          item.amountCents,
          item.assignmentReason,
          sortOrder,
        ),
      ...item.splits.map((split) =>
        c.env.DB
          .prepare(
            `INSERT INTO finance_receipt_item_splits (id, receipt_item_id, roommate_id, amount_cents)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), receiptItemId, split.roommateId, split.amountCents),
      ),
    ]),
  ]);

  return c.json({ transaction: await getTransaction(c.env.DB, id) }, 201);
});

app.put("/api/finance/expenses/:id/receipt-file", async (c) => {
  const id = c.req.param("id");
  await requireTransaction(c.env.DB, id, "expense");
  const form = await c.req.raw.formData();
  const receipt = form.get("receipt");
  if (!(receipt instanceof File) || receipt.size === 0) {
    return c.json({ error: "Bitte eine Originalrechnung auswahlen." }, 400);
  }

  const isPdf = receipt.type === "application/pdf" || receipt.name.toLocaleLowerCase().endsWith(".pdf");
  if (!isPdf && !receipt.type.startsWith("image/")) {
    return c.json({ error: "Als Original sind nur Bilder oder PDFs erlaubt." }, 400);
  }
  if (receipt.size > 12_000_000) {
    return c.json({ error: "Die Originalrechnung muss kleiner als 12 MB sein." }, 400);
  }

  const mimeType = isPdf ? "application/pdf" : receipt.type || "application/octet-stream";
  await c.env.DB
    .prepare(
      `INSERT INTO finance_receipt_uploads (
         transaction_id, original_name, mime_type, size_bytes, content, uploaded_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(transaction_id) DO UPDATE SET
         original_name = excluded.original_name,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         content = excluded.content,
         uploaded_at = excluded.uploaded_at`,
    )
    .bind(
      id,
      receipt.name.slice(0, 255) || "rechnung",
      mimeType,
      receipt.size,
      new Uint8Array(await receipt.arrayBuffer()),
      new Date().toISOString(),
    )
    .run();

  return c.json({ transaction: await getTransaction(c.env.DB, id) });
});

app.get("/api/finance/expenses/:id/receipt-file", async (c) => {
  const id = c.req.param("id");
  await requireTransaction(c.env.DB, id, "expense");
  const upload = await c.env.DB
    .prepare(
      `SELECT transaction_id, original_name, mime_type, size_bytes, content
       FROM finance_receipt_uploads WHERE transaction_id = ?`,
    )
    .bind(id)
    .first<ReceiptUploadContentRow>();
  if (!upload) {
    return c.json({ error: "Keine Originalrechnung gespeichert." }, 404);
  }

  const safeName = upload.original_name.replace(/[\r\n"]/g, "_");
  return new Response(upload.content, {
    headers: {
      "Content-Type": upload.mime_type,
      "Content-Length": String(upload.size_bytes),
      "Content-Disposition": `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(upload.original_name)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

app.patch("/api/finance/expenses/:id", zValidator("json", expenseSchema), async (c) => {
  const id = c.req.param("id");
  await requireTransaction(c.env.DB, id, "expense");

  const input = c.req.valid("json");
  const splits = buildExpenseSplits(input);
  const now = new Date().toISOString();
  const receiptItems = input.receiptItems?.map((item) => ({ id: crypto.randomUUID(), item }));

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
    ...(receiptItems
      ? [
          c.env.DB.prepare("DELETE FROM finance_receipt_items WHERE transaction_id = ?").bind(id),
          ...receiptItems.flatMap(({ id: receiptItemId, item }, sortOrder) => [
            c.env.DB
              .prepare(
                `INSERT INTO finance_receipt_items (
                  id, transaction_id, name, normalized_name, category, quantity,
                  amount_cents, assignment_reason, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                receiptItemId,
                id,
                item.name,
                item.normalizedName ?? item.name,
                item.category ?? "Sonstiges",
                item.quantity,
                item.amountCents,
                item.assignmentReason,
                sortOrder,
              ),
            ...item.splits.map((split) =>
              c.env.DB
                .prepare(
                  `INSERT INTO finance_receipt_item_splits (id, receipt_item_id, roommate_id, amount_cents)
                   VALUES (?, ?, ?, ?)`,
                )
                .bind(crypto.randomUUID(), receiptItemId, split.roommateId, split.amountCents),
            ),
          ]),
        ]
      : []),
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

app.get("/api/receipt-rules", async (c) => {
  return c.json({ rules: await listReceiptAssignmentRules(c.env.DB) });
});

app.put("/api/receipt-rules", zValidator("json", receiptAssignmentRulesSchema), async (c) => {
  const { rules } = c.req.valid("json");
  await replaceReceiptAssignmentRules(c.env.DB, rules);
  return c.json({ rules: await listReceiptAssignmentRules(c.env.DB) });
});

app.post("/api/finance/receipt/analyze", async (c) => {
  const form = await c.req.raw.formData();
  const receiptText = stringFormValue(form.get("receiptText")).trim();
  const receiptFile = form.get("receipt");
  const file = receiptFile instanceof File && receiptFile.size > 0 ? receiptFile : null;
  const fileIsPdf = Boolean(
    file && (file.type === "application/pdf" || file.name.toLocaleLowerCase().endsWith(".pdf")),
  );

  if (!receiptText && !file) {
    return c.json({ error: "Bitte Rechnungsbild oder Rechnungstext angeben." }, 400);
  }

  if (file && !file.type.startsWith("image/") && !fileIsPdf) {
    return c.json({ error: "Bitte ein Bild oder PDF der Rechnung hochladen." }, 400);
  }

  const maximumFileSize = fileIsPdf ? 12_000_000 : 4_000_000;
  if (file && file.size > maximumFileSize) {
    return c.json({ error: `Die Rechnungsdatei ist zu gross. Bitte unter ${fileIsPdf ? 12 : 4} MB bleiben.` }, 400);
  }

  const prompt = buildReceiptPrompt(await listReceiptAssignmentRules(c.env.DB), receiptText);
  const response = await c.env.analyzeReceipt({
    prompt,
    document: file,
    outputSchema: receiptJsonSchema(),
  });
  const parsed = parseModelJson(response);
  return c.json({ analysis: normalizeReceiptAnalysis(parsed, roommateIds) });
});

app.get("/api/tasks", async (c) => {
  return c.json({
    chores: await listChores(c.env.DB),
    rotations: await listRotations(c.env.DB),
  });
});

app.post("/api/tasks/rotations", zValidator("json", rotationSchema), async (c) => {
  const input = c.req.valid("json");
  const actor = c.get("roommate");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB
    .prepare(
      `INSERT INTO rotations (
        id, household_id, title, description, participant_ids, rotation_index,
        last_completed_at, last_completed_by, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)`,
    )
    .bind(
      id,
      household.id,
      input.title,
      input.description,
      JSON.stringify(stableParticipantIds(input.participantIds)),
      actor.id,
      now,
      now,
    )
    .run();

  return c.json({ rotation: await getRotation(c.env.DB, id) }, 201);
});

app.patch("/api/tasks/rotations/:id", zValidator("json", rotationSchema), async (c) => {
  const id = c.req.param("id");
  const existing = await getRotation(c.env.DB, id);
  const input = c.req.valid("json");
  const participants = stableParticipantIds(input.participantIds);

  await c.env.DB
    .prepare(
      `UPDATE rotations
       SET title = ?, description = ?, participant_ids = ?, rotation_index = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
    .bind(
      input.title,
      input.description,
      JSON.stringify(participants),
      existing.rotationIndex % participants.length,
      new Date().toISOString(),
      id,
      household.id,
    )
    .run();

  return c.json({ rotation: await getRotation(c.env.DB, id) });
});

app.delete("/api/tasks/rotations/:id", async (c) => {
  const id = c.req.param("id");
  await getRotation(c.env.DB, id);
  await c.env.DB.prepare("DELETE FROM rotations WHERE id = ? AND household_id = ?").bind(id, household.id).run();
  return c.json({ ok: true });
});

app.post("/api/tasks/rotations/:id/complete", async (c) => {
  const id = c.req.param("id");
  const actor = c.get("roommate");
  const completedAt = new Date().toISOString();
  const updated = completeRotation(await getRotation(c.env.DB, id), actor.id, completedAt);

  await c.env.DB
    .prepare(
      `UPDATE rotations
       SET rotation_index = ?, last_completed_at = ?, last_completed_by = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
    .bind(
      updated.rotationIndex,
      updated.lastCompletedAt,
      updated.lastCompletedBy,
      updated.updatedAt,
      id,
      household.id,
    )
    .run();

  return c.json({ rotation: await getRotation(c.env.DB, id) });
});

app.post("/api/tasks", zValidator("json", choreCreateSchema), async (c) => {
  const input = c.req.valid("json");
  const now = new Date().toISOString();
  const actor = c.get("roommate");
  const id = crypto.randomUUID();
  const participants = stableParticipantIds(input.participantIds);
  const nextDueDate = nextOccurrenceOnOrAfter(now.slice(0, 10), input.scheduleWeekday);

  await c.env.DB
    .prepare(
      `INSERT INTO chores (
        id, household_id, title, description, participant_ids, rotation_index,
        frequency_unit, frequency_interval, schedule_weekday, next_due_date, last_completed_at,
        last_completed_by, is_active, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'week', ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      household.id,
      input.title,
      input.description,
      JSON.stringify(participants),
      input.frequencyInterval,
      input.scheduleWeekday,
      nextDueDate,
      input.isActive ? 1 : 0,
      actor.id,
      now,
      now,
    )
    .run();

  return c.json({ chore: await getChore(c.env.DB, id) }, 201);
});

app.patch("/api/tasks/:id", zValidator("json", choreUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const existing = await requireChore(c.env.DB, id);
  const input = c.req.valid("json");
  const now = new Date().toISOString();
  const participants = stableParticipantIds(input.participantIds);
  const rotationIndex = existing.rotationIndex % participants.length;
  const updatesWeeklySchedule = existing.frequencyUnit === "week" || input.scheduleWeekday != null;
  const scheduleWeekday = updatesWeeklySchedule
    ? input.scheduleWeekday ?? existing.scheduleWeekday ?? defaultChoreWeekday
    : null;
  const frequencyUnit = updatesWeeklySchedule ? "week" : existing.frequencyUnit;
  const frequencyInterval = updatesWeeklySchedule ? input.frequencyInterval : existing.frequencyInterval;
  const nextDueDate =
    scheduleWeekday && scheduleWeekday !== existing.scheduleWeekday
      ? nextOccurrenceOnOrAfter(now.slice(0, 10), scheduleWeekday)
      : existing.nextDueDate;

  await c.env.DB
    .prepare(
      `UPDATE chores
       SET title = ?, description = ?, participant_ids = ?, rotation_index = ?,
           frequency_unit = ?, frequency_interval = ?, schedule_weekday = ?, next_due_date = ?,
           is_active = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
    .bind(
      input.title,
      input.description,
      JSON.stringify(participants),
      rotationIndex,
      frequencyUnit,
      frequencyInterval,
      scheduleWeekday,
      nextDueDate,
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
      : input.splits.filter((split) => split.owedCents !== 0);

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

async function listReceiptAssignmentRules(db: LocalDatabase): Promise<ReceiptAssignmentRule[]> {
  const rows = await db
    .prepare(
      `SELECT id, target, match, shares, extra_description
       FROM receipt_assignment_rules
       WHERE household_id = ?
       ORDER BY sort_order ASC, rowid ASC`,
    )
    .bind(household.id)
    .all<ReceiptAssignmentRuleRow>();

  return rows.results.map((row) => ({
    id: row.id,
    target: row.target,
    match: row.match,
    shares: JSON.parse(row.shares) as Record<string, number>,
    extraDescription: row.extra_description,
  }));
}

async function replaceReceiptAssignmentRules(
  db: LocalDatabase,
  rules: ReceiptAssignmentRule[],
): Promise<void> {
  const now = new Date().toISOString();
  db.batch([
    db.prepare("DELETE FROM receipt_assignment_rules WHERE household_id = ?").bind(household.id),
    ...rules.map((rule, sortOrder) =>
      db
        .prepare(
          `INSERT INTO receipt_assignment_rules (
            id, household_id, target, match, shares, extra_description,
            sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          rule.id,
          household.id,
          rule.target,
          rule.match,
          JSON.stringify(rule.shares),
          rule.extraDescription,
          sortOrder,
          now,
          now,
        ),
    ),
  ]);
}

async function listFinanceTransactions(db: LocalDatabase): Promise<FinanceTransaction[]> {
  const transactionRows = await db
    .prepare(
      `SELECT id, type, description, amount_cents, paid_by, from_roommate_id, to_roommate_id,
              paid_at, created_by, created_at, updated_at, receipt_source_ref
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

  const receiptItemsByTransaction = await listReceiptItems(db);
  const receiptUploadsByTransaction = await listReceiptUploads(db);

  return (transactionRows.results ?? []).map((row) =>
    mapTransaction(
      row,
      splitsByTransaction.get(row.id) ?? [],
      receiptItemsByTransaction.get(row.id) ?? [],
      receiptUploadsByTransaction.get(row.id),
    ),
  );
}

async function getTransaction(db: LocalDatabase, id: string): Promise<FinanceTransaction> {
  const row = await db
    .prepare(
      `SELECT id, type, description, amount_cents, paid_by, from_roommate_id, to_roommate_id,
              paid_at, created_by, created_at, updated_at, receipt_source_ref
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
  const receiptItems = (await listReceiptItems(db, id)).get(id) ?? [];
  const receiptUpload = (await listReceiptUploads(db, id)).get(id);

  return mapTransaction(
    row,
    (splitRows.results ?? []).map((split) => ({
      roommateId: split.roommate_id,
      owedCents: split.owed_cents,
    })),
    receiptItems,
    receiptUpload,
  );
}

async function listReceiptUploads(
  db: LocalDatabase,
  transactionId?: string,
): Promise<Map<string, FinanceTransaction["receiptUpload"]>> {
  const rows = transactionId
    ? db
        .prepare(
          `SELECT transaction_id, original_name, mime_type, size_bytes
           FROM finance_receipt_uploads WHERE transaction_id = ?`,
        )
        .bind(transactionId)
        .all<ReceiptUploadRow>()
    : db
        .prepare(
          `SELECT u.transaction_id, u.original_name, u.mime_type, u.size_bytes
           FROM finance_receipt_uploads u
           INNER JOIN finance_transactions t ON t.id = u.transaction_id
           WHERE t.household_id = ?`,
        )
        .bind(household.id)
        .all<ReceiptUploadRow>();

  return new Map(
    rows.results.map((row) => [
      row.transaction_id,
      {
        fileName: row.original_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        url: `/api/finance/expenses/${row.transaction_id}/receipt-file`,
      },
    ]),
  );
}

async function listReceiptItems(
  db: LocalDatabase,
  transactionId?: string,
): Promise<Map<string, ReceiptItem[]>> {
  const itemRows = transactionId
    ? db
        .prepare(
          `SELECT id, transaction_id, name, normalized_name, category, quantity, amount_cents, assignment_reason
           FROM finance_receipt_items WHERE transaction_id = ? ORDER BY sort_order ASC, rowid ASC`,
        )
        .bind(transactionId)
        .all<ReceiptItemRow>()
    : db
        .prepare(
          `SELECT i.id, i.transaction_id, i.name, i.normalized_name, i.category,
                  i.quantity, i.amount_cents, i.assignment_reason
           FROM finance_receipt_items i
           INNER JOIN finance_transactions t ON t.id = i.transaction_id
           WHERE t.household_id = ? ORDER BY i.transaction_id, i.sort_order ASC, i.rowid ASC`,
        )
        .bind(household.id)
        .all<ReceiptItemRow>();

  const splitRows = transactionId
    ? db
        .prepare(
          `SELECT s.receipt_item_id, s.roommate_id, s.amount_cents
           FROM finance_receipt_item_splits s
           INNER JOIN finance_receipt_items i ON i.id = s.receipt_item_id
           WHERE i.transaction_id = ? ORDER BY s.rowid ASC`,
        )
        .bind(transactionId)
        .all<ReceiptItemSplitRow>()
    : db
        .prepare(
          `SELECT s.receipt_item_id, s.roommate_id, s.amount_cents
           FROM finance_receipt_item_splits s
           INNER JOIN finance_receipt_items i ON i.id = s.receipt_item_id
           INNER JOIN finance_transactions t ON t.id = i.transaction_id
           WHERE t.household_id = ? ORDER BY s.rowid ASC`,
        )
        .bind(household.id)
        .all<ReceiptItemSplitRow>();

  const splitsByItem = new Map<string, ReceiptItem["splits"]>();
  for (const row of splitRows.results) {
    const splits = splitsByItem.get(row.receipt_item_id) ?? [];
    splits.push({ roommateId: row.roommate_id, amountCents: row.amount_cents });
    splitsByItem.set(row.receipt_item_id, splits);
  }

  const itemsByTransaction = new Map<string, ReceiptItem[]>();
  for (const row of itemRows.results) {
    const items = itemsByTransaction.get(row.transaction_id) ?? [];
    items.push({
      name: row.name,
      normalizedName: row.normalized_name,
      category: row.category,
      quantity: row.quantity,
      amountCents: row.amount_cents,
      assignmentReason: row.assignment_reason,
      splits: splitsByItem.get(row.id) ?? [],
    });
    itemsByTransaction.set(row.transaction_id, items);
  }
  return itemsByTransaction;
}

async function requireTransaction(
  db: LocalDatabase,
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

function mapTransaction(
  row: TransactionRow,
  splits: FinanceSplit[],
  receiptItems: ReceiptItem[],
  receiptUpload?: FinanceTransaction["receiptUpload"],
): FinanceTransaction {
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
    receiptItems,
    receiptSourceRef: row.receipt_source_ref ?? undefined,
    receiptUpload,
  };
}

async function listChores(db: LocalDatabase): Promise<Chore[]> {
  const rows = await db
    .prepare(
      `SELECT id, title, description, participant_ids, rotation_index,
              frequency_unit, frequency_interval, schedule_weekday, next_due_date,
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

async function getChore(db: LocalDatabase, id: string): Promise<Chore> {
  const row = await db
    .prepare(
      `SELECT id, title, description, participant_ids, rotation_index,
              frequency_unit, frequency_interval, schedule_weekday, next_due_date,
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

async function requireChore(db: LocalDatabase, id: string): Promise<Chore> {
  return getChore(db, id);
}

async function listRotations(db: LocalDatabase): Promise<Rotation[]> {
  const rows = await db
    .prepare(
      `SELECT id, title, description, participant_ids, rotation_index,
              last_completed_at, last_completed_by, created_by, created_at, updated_at
       FROM rotations
       WHERE household_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(household.id)
    .all<RotationRow>();

  return (rows.results ?? []).map(mapRotation);
}

async function getRotation(db: LocalDatabase, id: string): Promise<Rotation> {
  const row = await db
    .prepare(
      `SELECT id, title, description, participant_ids, rotation_index,
              last_completed_at, last_completed_by, created_by, created_at, updated_at
       FROM rotations
       WHERE id = ? AND household_id = ?`,
    )
    .bind(id, household.id)
    .first<RotationRow>();

  if (!row) {
    throw new HTTPError(404, "Rotation nicht gefunden.");
  }

  return mapRotation(row);
}

function mapRotation(row: RotationRow): Rotation {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    participantIds: JSON.parse(row.participant_ids) as string[],
    rotationIndex: row.rotation_index,
    lastCompletedAt: row.last_completed_at,
    lastCompletedBy: row.last_completed_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    scheduleWeekday: row.schedule_weekday,
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

function buildReceiptPrompt(receiptAssignmentRules: ReceiptAssignmentRule[], receiptText: string): string {
  const roommateList = roommates
    .map((roommate) => `- ${roommate.name}: roommateId "${roommate.id}"`)
    .join("\n");
  const optionalReceiptText = receiptText
    ? `\nOCR or pasted receipt text, if useful:\n${receiptText}\n`
    : "";

  return `You extract grocery receipt line items and assign each item to roommates.

Return only valid JSON. Use integer cents, not floats. Use YYYY-MM-DD dates when visible.
Use only these roommate IDs:
${roommateList}

Assignment rules supplied by the household:
${JSON.stringify(receiptAssignmentRules, null, 2)}

Rules:
- Extract detailed receipt items, not only the grand total.
- Preserve the exact printed product label in "name".
- Set "normalizedName" to a stable generic German product name for tracking: for example every egg SKU becomes "Eier", apple variants become "Äpfel", and milk brands become "Milch".
- Set "category" to exactly one of: ${receiptTrackingCategories.join(", ")}.
- Choose categories by the actual product, not by the roommate assignment rule. Coupons, discounts, Pfand and Leergut belong to "Pfand & Rabatte".
- Omit zero-priced items, payment lines, tax summaries, loyalty points, and savings summary lines.
- Preserve coupons and discounts as separate negative line items. Apply a matching coupon rule; never net them into the related product.
- Preserve returned deposits and other standalone credits as negative line items with negative roommate splits.
- Read the printed SUMME as the authoritative grand total and ensure the signed sum of all positions equals it.
- The sum of all item amounts must equal the receipt grand total.
- Match rule names case-insensitively and semantically against receipt item names.
- A matching rule with target "item" takes precedence over a rule with target "category".
- The values in "shares" are percentage allocations keyed by roommate ID.
- Use "extraDescription" to interpret quantities or ambiguous receipt lines.
- If no rule matches, split the item equally across all roommates.
- Every item split must sum exactly to that item amount in cents.
- Use the configured roommate IDs, never free-form names.
- Add short assignmentReason values in German.
${optionalReceiptText}`;
}

function receiptJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["merchant", "receiptDate", "items", "warnings"],
    properties: {
      merchant: { type: ["string", "null"] },
      receiptDate: { type: ["string", "null"] },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "normalizedName", "category", "quantity", "amountCents", "assignmentReason", "splits"],
          properties: {
            name: { type: "string" },
            normalizedName: { type: "string" },
            category: { type: "string", enum: receiptTrackingCategories },
            quantity: { type: ["string", "null"] },
            amountCents: { type: "integer" },
            assignmentReason: { type: "string" },
            splits: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["roommateId", "amountCents"],
                properties: {
                  roommateId: { type: "string", enum: roommateIds },
                  amountCents: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  };
}

function parseModelJson(value: unknown): unknown {
  if (value && typeof value === "object") {
    return value;
  }

  if (typeof value !== "string") {
    throw new HTTPError(400, "Codex hat keine lesbare JSON-Antwort geliefert.");
  }

  try {
    return JSON.parse(value);
  } catch {
    const match = /```(?:json)?\s*([\s\S]*?)```/.exec(value) ?? /(\{[\s\S]*\})/.exec(value);
    if (!match) {
      throw new HTTPError(400, "Codex hat keine JSON-Antwort geliefert.");
    }
    try {
      return JSON.parse(match[1]);
    } catch {
      throw new HTTPError(400, "Codex hat keine gultige JSON-Antwort geliefert.");
    }
  }
}

function stringFormValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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

export { app };
