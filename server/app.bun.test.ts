import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { roommateIds } from "../src/shared/config";
import type { Chore, Rotation } from "../src/shared/types";
import { weekdayOfDate } from "../src/shared/tasks";
import { app } from "./app";
import { InferenceError } from "./inference";
import { parseIdentityMappings } from "./identity";
import { createHmac } from "node:crypto";
import { parseTrustedOrigins } from "./config";
import { LocalDatabase } from "./db";

let database: LocalDatabase;
const proxyToken = "a".repeat(64);
const identity = { email: "owner@example.test", uid: "fixture-owner", roommateId: "kran" };
const identityHeaders = { "X-Flat-Email": identity.email, "X-Flat-Uid": identity.uid };
const origin = "http://flat.test";
let testTime = Date.now();

beforeEach(() => {
  testTime += 60 * 60 * 1000;
  setSystemTime(testTime);
  database = new LocalDatabase(":memory:");
  database.migrate();
});

afterEach(() => { database.close(); setSystemTime(); });

describe("chore API", () => {
  test("defaults new chores to Wednesday and rejects unknown weekdays", async () => {
    const cookie = await loginCookie();
    const baseChore = {
      title: "Bad putzen",
      description: "",
      participantIds: [roommateIds[0]],
      frequencyInterval: 1,
      isActive: true,
    };

    const invalidResponse = await request("/api/tasks", cookie, {
      ...baseChore,
      scheduleWeekday: "funday",
    });
    expect(invalidResponse.status).toBe(400);

    const response = await request("/api/tasks", cookie, baseChore);
    expect(response.status).toBe(201);
    const { chore } = (await response.json()) as {
      chore: { frequencyUnit: string; scheduleWeekday: string; nextDueDate: string };
    };
    expect(chore.frequencyUnit).toBe("week");
    expect(chore.scheduleWeekday).toBe("wednesday");
    expect(weekdayOfDate(chore.nextDueDate)).toBe("wednesday");
  });

  test("projects missed weeks on reads and anchors manual corrections to the current occurrence", async () => {
    setSystemTime(new Date("2026-09-23T10:00:00Z"));
    const cookie = await loginCookie();
    const input = { title: "Weekly", participantIds: roommateIds };
    const { chore } = await (await request("/api/tasks", cookie, input)).json() as { chore: Chore };
    setSystemTime(new Date("2026-10-07T10:00:00Z"));
    const listed = await (await request("/api/tasks", cookie, undefined, "GET")).json() as { chores: Chore[] };
    expect(listed.chores[0]).toMatchObject({ rotationIndex: 2, nextDueDate: "2026-10-07", lastCompletedAt: null });
    const corrected = await request(`/api/tasks/${chore.id}`, cookie, { ...input, assigneeId: "stadlmann" }, "PATCH");
    expect((await corrected.json() as { chore: Chore }).chore).toMatchObject({ rotationIndex: 1, nextDueDate: "2026-10-07", lastCompletedAt: null });
    setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const later = await (await request("/api/tasks", cookie, undefined, "GET")).json() as { chores: Chore[] };
    expect(later.chores[0]).toMatchObject({ rotationIndex: 2, nextDueDate: "2026-10-14", lastCompletedAt: null });
    const completed = await request(`/api/tasks/${chore.id}/complete`, cookie, {});
    expect((await completed.json() as { chore: Chore }).chore).toMatchObject({ rotationIndex: 0, nextDueDate: "2026-10-21", lastCompletedBy: "kran" });
  });

  test("corrects assignees without completing and preserves identity when participants change", async () => {
    const cookie = await loginCookie();
    const input = { title: "Assignment", participantIds: roommateIds };
    for (const kind of ["chore", "rotation"] as const) {
      const base = kind === "chore" ? "/api/tasks" : "/api/tasks/rotations";
      const created = await (await request(base, cookie, input)).json() as Record<string, Chore & Rotation>;
      const original = created[kind];
      const path = `${base}/${original.id}`;
      const response = await request(path, cookie, { ...input, assigneeId: "mitter" }, "PATCH");
      expect(response.status).toBe(200);
      const corrected = (await response.json() as Record<string, Chore & Rotation>)[kind];
      expect(corrected.rotationIndex).toBe(2);
      expect(corrected.lastCompletedAt).toBeNull();
      if (kind === "chore") expect(corrected.nextDueDate).toBe(original.nextDueDate);
      const edited = await request(path, cookie, { ...input, participantIds: ["kran", "mitter"] }, "PATCH");
      expect((await edited.json() as Record<string, Chore & Rotation>)[kind].rotationIndex).toBe(1);
      const invalid = await request(path, cookie, { ...input, participantIds: ["kran"], assigneeId: "mitter" }, "PATCH");
      expect(invalid.status).toBe(400);
      const completed = await request(`${path}/complete`, cookie, {});
      expect((await completed.json() as Record<string, Chore & Rotation>)[kind].rotationIndex).toBe(0);
    }
  });

  test("editing a nonweekly legacy chore does not convert its schedule", async () => {
    database
      .prepare(
        `INSERT INTO chores (
          id, household_id, title, description, participant_ids, rotation_index,
          frequency_unit, frequency_interval, schedule_weekday, next_due_date,
          last_completed_at, last_completed_by, is_active, created_by, created_at, updated_at
        ) VALUES ('legacy-daily', 'wg-main', 'Legacy', '', '["kran"]', 0,
                  'day', 4, NULL, '2026-09-07', NULL, NULL, 1, 'kran', 'created', 'updated')`,
      )
      .run();
    const cookie = await loginCookie();

    const response = await request(
      "/api/tasks/legacy-daily",
      cookie,
      {
        title: "Legacy renamed",
        description: "",
        participantIds: [roommateIds[0]],
        frequencyInterval: 1,
        scheduleWeekday: null,
        isActive: true,
      },
      "PATCH",
    );
    expect(response.status).toBe(200);
    const { chore } = (await response.json()) as {
      chore: { title: string; frequencyUnit: string; frequencyInterval: number; nextDueDate: string };
    };
    expect(chore).toMatchObject({
      title: "Legacy renamed",
      frequencyUnit: "day",
      frequencyInterval: 4,
      nextDueDate: "2026-09-07",
    });
  });
});

async function loginCookie(): Promise<string> {
  const payload = `stadlmann.${Date.now() + 60_000}`;
  return `flat_session=${payload}.${createHmac("sha256", "old-secret").update(payload).digest("base64url")}`;
}

async function request(path: string, cookie: string, body: unknown, method = "POST"): Promise<Response> {
  return await app.request(
    path,
    {
      method,
      headers: { ...identityHeaders, "X-Flat-Proxy-Token": proxyToken, Origin: origin, "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    },
    bindings(),
  );
}

function bindings() {
  return {
    DB: database,
    IDENTITY_MAP: [identity],
    TRUSTED_ORIGINS: [origin, "https://flat.public.test", "https://flat.private.test:8787"],
    analyzeReceipt: async () => {
      throw new Error("Receipt analysis is not used in API tests.");
    },
  };
}


describe("trusted origins configuration", () => {
  test("requires explicit canonical HTTP(S) origins", () => {
    expect(parseTrustedOrigins(" https://flat.public.test,https://flat.private.test:8787,http://127.0.0.1:4387 ")).toEqual([
      "https://flat.public.test", "https://flat.private.test:8787", "http://127.0.0.1:4387",
    ]);
    for (const invalid of [undefined, "", " ", "*", "null", "ftp://flat.test", "https://flat.test/", "https://user:pass@flat.test", "https://flat.test/path", "https://flat.test?query", "https://flat.test#hash", "https://flat.test,", "https://flat.test:443"]) {
      expect(() => parseTrustedOrigins(invalid)).toThrow();
    }
  });
});

describe("verified proxy identity", () => {
  function send(path = "/api/session", extra: Record<string, string> = {}, method = "GET", body?: unknown, map = [identity]) {
    return app.request(path, { method, headers: {
      ...identityHeaders, "X-Flat-Proxy-Token": proxyToken, Origin: origin,
      "Content-Type": "application/json", ...extra,
    }, body: body === undefined ? undefined : JSON.stringify(body) }, { ...bindings(), IDENTITY_MAP: map });
  }
  test("recognizes existing roommate without a selectable session", async () => {
    const response = await send();
    expect(await response.json()).toMatchObject({ authenticated: true, roommate: { id: "kran" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
  test("ignores and expires a valid legacy cookie for another roommate", async () => {
    const response = await send("/api/session", { Cookie: await loginCookie() });
    expect(await response.json()).toMatchObject({ roommate: { id: "kran" } });
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await send("/api/session", { Cookie: await loginCookie(), "X-Flat-Email": "" })).status).toBe(403);
  });
  test("rejects missing, unknown, duplicated and mismatched identity", async () => {
    for (const extra of [
      { "X-Flat-Email": "" }, { "X-Flat-Uid": "" },
      { "X-Flat-Email": "unknown@example.test" }, { "X-Flat-Uid": "unknown" },
      { "X-Flat-Email": `${identity.email}, ${identity.email}` },
      { "X-Flat-Uid": `${identity.uid}, ${identity.uid}` },
      { "X-Flat-Email": "", "X-Authentik-Email": identity.email, "Remote-User": "kran" },
    ] as Record<string, string>[]) expect((await send("/api/session", extra)).status).toBe(403);
    expect((await send("/api/session", {}, "GET", undefined, [identity, identity])).status).toBe(403);
  });
  test("denies an unmapped gateway identity even when it belongs to WG", async () => {
    const response = await send("/api/session", {
      "X-Flat-Email": "unmapped@example.test", "X-Flat-Uid": "unmapped-native-uid",
      "X-Authentik-Groups": "WG",
    });
    expect(response.status).toBe(403);
  });
  test("trusted transport identity needs no shared proxy secret", async () => {
    for (const token of ["", "b".repeat(64), `${proxyToken}, ${proxyToken}`]) {
      expect((await send("/api/finance", { "X-Flat-Proxy-Token": token, Cookie: await loginCookie() })).status).toBe(200);
    }
    expect((await app.request("/healthz", {}, bindings())).status).toBe(200);
    expect((await app.request("/healthz", { method: "POST" }, bindings())).status).toBe(404);
  });
  test("obsolete identity-selection endpoints cannot change attribution", async () => {
    for (const path of ["/api/login", "/api/logout"]) {
      expect((await send(path, {}, "POST", { roommateId: "stadlmann" })).status).toBe(410);
    }
    expect(await (await send()).json()).toMatchObject({ roommate: { id: "kran" } });
  });
  test("retains exact-origin CSRF checks for all unsafe verbs", async () => {
    for (const untrusted of ["", "null", "https://evil.test", "http://flat.test/", "http://flat.test.evil.test", "http://flat.test, https://evil.test"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect((await send("/api/finance/expenses", { Origin: untrusted, "X-Forwarded-Host": "flat.test" }, method, {})).status).toBe(403);
      }
    }
    const response = await app.request("/api/finance/expenses", { method: "POST", headers: { ...identityHeaders, "X-Flat-Proxy-Token": proxyToken } }, bindings());
    expect(response.status).toBe(403);
  });
  test("attributes expenses to verified actor while preserving selected payer and balances", async () => {
    const response = await send("/api/finance/expenses", { Cookie: await loginCookie() }, "POST", {
      description: "Isolated attribution test", amountCents: 1200, paidBy: "stadlmann", paidAt: "2026-09-20",
      splitMode: "equal", participantIds: roommateIds, createdBy: "mitter",
    });
    expect(response.status).toBe(201);
    const { transaction } = await response.json() as { transaction: { createdBy: string; paidBy: string } };
    expect(transaction).toMatchObject({ createdBy: "kran", paidBy: "stadlmann" });
    const finance = await (await send("/api/finance")).json() as { balances: { roommateId: string; balanceCents: number }[] };
    expect(finance.balances).toContainEqual(expect.objectContaining({ roommateId: "stadlmann", balanceCents: 800 }));
  });
  test("configuration rejects ambiguous or invalid mappings without exposing them", () => {
    expect(parseIdentityMappings(JSON.stringify([identity]))).toEqual([identity]);
    for (const entries of [[], [identity, identity], [identity, { ...identity, email: "other@example.test" }],
      [identity, { ...identity, uid: "other" }], [identity, { ...identity, email: "other@example.test", uid: "other" }],
      [{ ...identity, roommateId: "unknown" }], [{ ...identity, email: "one@example.test,two@example.test" }]]) {
      expect(() => parseIdentityMappings(JSON.stringify(entries))).toThrow("requires unique");
    }
    expect(() => parseIdentityMappings(undefined)).toThrow();
  });
});

// Real routes + isolated SQLite; only inference is injected. No provider call.
import type { ReceiptAnalysis, ReceiptItem, ReceiptLearningPayload, ReceiptAssignmentRule } from "../src/shared/types";
import { aggregateReceiptSplits } from "../src/shared/receipt";

describe("conservative receipt learning", () => {
  const headers = { ...identityHeaders, "X-Flat-Proxy-Token": proxyToken, Origin: origin };
  const fixtureItem = (name = "Lernprodukt", amount = 300): ReceiptItem => ({ name, normalizedName: name, category: "Sonstiges", quantity: "1", amountCents: amount, assignmentReason: "Vorschlag",
    splits: roommateIds.map((roommateId) => ({ roommateId, amountCents: amount / 3 })) });
  let sourceNumber = 0;
  async function analyze(items = [fixtureItem()], file?: File, text = `synthetic independent receipt ${++sourceNumber}`) {
    const body = new FormData(); body.set("receiptText", text); if (file) body.set("receipt", file);
    const response = await app.request("/api/finance/receipt/analyze", { method: "POST", headers, body }, {
      ...bindings(), analyzeReceipt: async () => JSON.stringify({ merchant: "Test", items, warnings: [] }),
    });
    expect(response.status).toBe(200);
    return await response.json() as { analysis: ReceiptAnalysis; analysisId: string };
  }
  function expense(draft: { analysis: ReceiptAnalysis; analysisId: string }, target?: string) {
    const receiptItems = draft.analysis.items.map((item) => target ? { ...item, splits: [{ roommateId: target, amountCents: item.amountCents }] } : item);
    return { receiptAnalysisId: draft.analysisId, description: "Synthetic receipt", paidBy: "kran", paidAt: "2026-10-05", splitMode: "custom", participantIds: [], amountCents: draft.analysis.totalCents,
      receiptItems, splits: aggregateReceiptSplits(receiptItems, roommateIds).map((s) => ({ roommateId: s.roommateId, owedCents: s.amountCents })) };
  }
  async function save(draft: Awaited<ReturnType<typeof analyze>>, target?: string) {
    const body = expense(draft, target);
    const response = await request("/api/finance/expenses", "", body);
    expect(response.status).toBe(201);
    return { body, transaction: (await response.json() as { transaction: { id: string } }).transaction };
  }
  async function state() {
    return await (await app.request("/api/receipt-learning", { headers }, bindings())).json() as ReceiptLearningPayload;
  }
  async function change(key: string, action: string) {
    const response = await request("/api/receipt-learning/product", "", { key, action });
    expect(response.status).toBe(200);
  }
  async function rules(next: ReceiptAssignmentRule[]) {
    const current = await (await app.request("/api/receipt-rules", { headers }, bindings())).json() as { revision: string; rules: ReceiptAssignmentRule[] };
    const response = await request("/api/receipt-rules", "", { rules: next, revision: current.revision }, "PUT");
    expect(response.status).toBe(200);
  }
  test("only saved corrections count; two independent receipts influence the actual next analysis", async () => {
    await analyze(); // abandoned
    await save(await analyze()); // unchanged guess
    expect((await state()).products).toEqual([]);
    const first = await analyze(); const saved = await save(first, "kran");
    expect((await state()).products[0]).toMatchObject({ evidenceCount: 1, status: "pending" });
    expect((await analyze()).analysis.items[0].splits).toHaveLength(3);
    const replay = await request("/api/finance/expenses", "", saved.body);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { transaction: { id: string } }).transaction.id).toBe(saved.transaction.id);
    expect((await state()).products[0].evidenceCount).toBe(1);
    await save(await analyze(), "kran");
    expect((await state()).products[0]).toMatchObject({ evidenceCount: 2, status: "active", weights: [1, 0, 0] });
    const next = await analyze();
    expect(next.analysis.items[0].splits).toEqual([{ roommateId: "kran", amountCents: 300 }]);
    expect(next.analysis.items[0].assignmentReason).toContain("bisherigen Korrekturen");
    await save(next); // accepting a learned guess must never reinforce it
    expect((await state()).products[0].evidenceCount).toBe(2);
  });
  test("contradictions suspend suggestions until the recent three corrections agree", async () => {
    for (let i = 0; i < 2; i++) await save(await analyze(), "kran");
    await save(await analyze(), "mitter");
    expect((await state()).products[0].status).toBe("conflict");
    expect((await analyze()).analysis.items[0].splits).toHaveLength(3);
    await save(await analyze(), "mitter");
    expect((await state()).products[0].status).toBe("conflict");
    await save(await analyze(), "mitter");
    expect((await analyze()).analysis.items[0].splits).toEqual([{ roommateId: "mitter", amountCents: 300 }]);
  });
  test("original upload gates evidence, preserves bytes and safely deduplicates POST and PUT retries", async () => {
    const file = new File(["synthetic original image"], "test.png", { type: "image/png" });
    const draft = await analyze(undefined, file); const saved = await save(draft, "kran");
    expect((await state()).products).toEqual([]);
    const put = async (value: File) => { const body = new FormData(); body.set("receipt", value); return app.request(`/api/finance/expenses/${saved.transaction.id}/receipt-file`, { method: "PUT", headers, body }, bindings()); };
    expect((await put(new File(["wrong"], "test.png", { type: "image/png" }))).status).toBe(400);
    expect((await state()).products).toEqual([]);
    expect((await put(file)).status).toBe(200); expect((await put(file)).status).toBe(200);
    expect((await state()).products[0].evidenceCount).toBe(1);
    const original = await app.request(`/api/finance/expenses/${saved.transaction.id}/receipt-file`, { headers }, bindings());
    expect(await original.text()).toBe(await file.text());
    await save(await analyze(undefined, file), "kran"); // same source is not independent
    expect((await state()).products[0].evidenceCount).toBe(1);
    await request(`/api/finance/expenses/${saved.transaction.id}`, "", saved.body, "PATCH");
    expect((await state()).products).toEqual([]);
    expect((await put(file)).status).toBe(200);
    expect((await state()).products).toEqual([]); // an old upload cannot resurrect invalidated evidence
  });
  test("rejects foreign/fabricated analyses, mismatched items and invalid saves; legacy clients never teach", async () => {
    const draft = await analyze();
    const body = expense(draft, "kran");
    expect((await request("/api/finance/expenses", "", { ...body, receiptAnalysisId: crypto.randomUUID() })).status).toBe(409);
    database.prepare("UPDATE receipt_analysis_drafts SET actor_id = 'mitter' WHERE id = ?").bind(draft.analysisId).run();
    expect((await request("/api/finance/expenses", "", body)).status).toBe(409);
    database.prepare("UPDATE receipt_analysis_drafts SET actor_id = 'kran' WHERE id = ?").bind(draft.analysisId).run();
    const mismatch = structuredClone(body); mismatch.receiptItems[0].name = "different";
    expect((await request("/api/finance/expenses", "", mismatch)).status).toBe(400);
    const invalid = structuredClone(body); invalid.receiptItems[0].splits[0].amountCents = 299;
    expect((await request("/api/finance/expenses", "", invalid)).status).toBe(400);
    expect((await state()).products).toEqual([]);
    const legacy = { ...body, receiptAnalysisId: undefined };
    expect((await request("/api/finance/expenses", "", legacy)).status).toBe(201);
    expect((await state()).products).toEqual([]);
  });
  test("signed corrections work, mixed signs never teach, and duplicate items count once", async () => {
    const draft = await analyze([fixtureItem("Kauf", 600), fixtureItem("Rabatt", -300)]);
    await save(draft, "kran");
    const second = await analyze([fixtureItem("Kauf", 600), fixtureItem("Rabatt", -300)]);
    await save(second, "kran");
    expect((await analyze([fixtureItem("Kauf", 600), fixtureItem("Rabatt", -300)])).analysis.items[1].splits).toEqual([{ roommateId: "kran", amountCents: -300 }]);
    const mixed = await analyze([fixtureItem("Mixed")]); const body = expense(mixed);
    body.receiptItems[0].splits = [{ roommateId: "kran", amountCents: 400 }, { roommateId: "mitter", amountCents: -100 }];
    body.splits = [{ roommateId: "kran", owedCents: 400 }, { roommateId: "mitter", owedCents: -100 }];
    expect((await request("/api/finance/expenses", "", body)).status).toBe(201);
    expect((await state()).products.some((p) => p.key === "mixed")).toBe(false);
    await save(await analyze([fixtureItem("Doppelt"), fixtureItem("Doppelt")]), "kran");
    expect((await state()).products.find((p) => p.key === "doppelt")?.evidenceCount).toBe(1);
  });
  test("reset, per-product disable, overall pause and expense deletion have lasting effects", async () => {
    await save(await analyze(), "kran"); const saved = await save(await analyze(), "kran");
    await change("lernprodukt", "disable");
    expect((await analyze()).analysis.items[0].splits).toHaveLength(3);
    await save(await analyze(), "mitter");
    expect((await state()).products[0].evidenceCount).toBe(2);
    await change("lernprodukt", "enable");
    expect((await analyze()).analysis.items[0].splits).toHaveLength(1);
    await request("/api/receipt-learning", "", { enabled: false }, "PATCH");
    await save(await analyze(), "mitter");
    expect((await state()).products[0].evidenceCount).toBe(2);
    await request("/api/receipt-learning", "", { enabled: true }, "PATCH");
    await request(`/api/finance/expenses/${saved.transaction.id}`, "", {}, "DELETE");
    expect((await state()).products[0].status).toBe("pending");
    expect((await request("/api/finance/expenses", "", saved.body)).status).toBe(409);
    await change("lernprodukt", "reset");
    expect((await state()).products[0].evidenceCount).toBe(0);
    expect((await analyze()).analysis.items[0].splits).toHaveLength(3);
    await save(await analyze(), "mitter");
    expect((await state()).products[0]).toMatchObject({ evidenceCount: 1, status: "pending" });
  });
  test("explicit item/category rules beat learning and legacy equal overrides; revisions prevent lost updates", async () => {
    await rules([]);
    for (let i = 0; i < 2; i++) await save(await analyze([fixtureItem("Olivenöl")]), "kran");
    expect((await analyze([fixtureItem("Olivenöl")])).analysis.items[0].splits).toHaveLength(1);
    const rule: ReceiptAssignmentRule = { id: "explicit", target: "item", match: "Olivenöl", shares: { kran: 0, stadlmann: 100, mitter: 0 }, extraDescription: null };
    await rules([rule]);
    expect((await analyze([fixtureItem("Olivenöl")])).analysis.items[0].splits).toEqual([{ roommateId: "stadlmann", amountCents: 300 }]);
    await rules([{ ...rule, target: "category", match: "Sonstiges" }]);
    expect((await analyze([fixtureItem("Olivenöl")])).analysis.items[0].splits).toEqual([{ roommateId: "stadlmann", amountCents: 300 }]);
    const current = await (await app.request("/api/receipt-rules", { headers }, bindings())).json() as { revision: string; rules: ReceiptAssignmentRule[] };
    await rules([]);
    expect((await request("/api/receipt-rules", "", current, "PUT")).status).toBe(409);
    const fresh = await (await app.request("/api/receipt-rules", { headers }, bindings())).json() as { revision: string };
    expect((await request("/api/receipt-rules", "", { revision: fresh.revision, rules: [rule, { ...rule, id: "two", match: "  OLIVENÖL " }] }, "PUT")).status).toBe(400);
  });
  test("true equal and exact non-equal weights survive a larger future receipt", async () => {
    const original = fixtureItem("Gleichprobe", 301);
    original.splits = [{ roommateId: "mitter", amountCents: 301 }];
    for (let i = 0; i < 2; i++) {
      const draft = await analyze([original]); const body = expense(draft);
      body.receiptItems[0].splits = [{ roommateId: "kran", amountCents: 101 }, { roommateId: "stadlmann", amountCents: 100 }, { roommateId: "mitter", amountCents: 100 }];
      body.splits = body.receiptItems[0].splits.map((split) => ({ roommateId: split.roommateId, owedCents: split.amountCents }));
      expect((await request("/api/finance/expenses", "", body)).status).toBe(201);
    }
    expect((await state()).products[0].weights).toEqual([1, 1, 1]);
    expect((await analyze([fixtureItem("Gleichprobe", 1200)])).analysis.items[0].splits.map((s) => s.amountCents)).toEqual([400, 400, 400]);
  });
  test("a validated semantic Beeren rule outranks a learned Erdbeeren preference", async () => {
    const current = await (await app.request("/api/receipt-rules", { headers }, bindings())).json() as { rules: ReceiptAssignmentRule[] };
    const berryRule = current.rules.find((r) => r.id === "rule-beeren")!;
    await rules([]);
    for (let i = 0; i < 2; i++) await save(await analyze([fixtureItem("Erdbeeren")]), "mitter");
    await rules([berryRule]);
    const item = { ...fixtureItem("Erdbeeren"), assignmentRuleId: "rule-beeren" };
    const result = await analyze([item]);
    expect(result.analysis.items[0].splits).toEqual([{ roommateId: "kran", amountCents: 195 }, { roommateId: "stadlmann", amountCents: 105 }]);
    expect(result.analysis.items[0].assignmentReason).toBe("WG-Regel: Beeren");
  });

});

// Authentication failures must be distinguishable from inference/protocol failures.
describe("auth lifecycle route regressions", () => {
  const headers = { ...identityHeaders, "X-Flat-Proxy-Token": proxyToken, Origin: origin };
  test("trailing slashes never redirect multipart bodies; unknown receipt paths stay JSON 404", async () => {
    for (const path of ["/api/finance/receipt/analyze", "/api/finance/receipt/analyze/"]) {
      const body = new FormData();
      const response = await app.request(path, { method: "POST", headers, body }, bindings());
      expect(response.status).toBe(400);
      expect(response.headers.has("Location")).toBe(false);
      expect(await response.json()).toMatchObject({ error: "Bitte Rechnungsbild oder Rechnungstext angeben." });
    }
    for (const path of ["/api", "/api/receipts", "/api/receipts/"]) {
      const response = await app.request(path, { headers }, bindings());
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not_found" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
  test("provider 401/redirect/timeout cannot become user expiry or write an analysis draft", async () => {
    for (const message of ["Rechnungsanalyse fehlgeschlagen (HTTP 401).", "Redirect", "Rechnungsanalyse hat das Zeitlimit uberschritten."]) {
      const body = new FormData(); body.set("receiptText", "Synthetic receipt");
      const response = await app.request("/api/finance/receipt/analyze", { method: "POST", headers, body }, {
        ...bindings(), analyzeReceipt: async () => { throw new InferenceError(message, message.includes("Zeitlimit") ? "timeout" : "unavailable"); },
      });
      expect(response.status).toBe(message.includes("Zeitlimit") ? 504 : 502);
      expect((await response.json() as { error: string }).error).not.toContain("401");
    }
    expect(database.prepare("SELECT COUNT(*) AS count FROM receipt_analysis_drafts").first()).toMatchObject({ count: 0 });
  });
  test("stale actor rejects both reads and mutations before route processing", async () => {
    for (const [path, method] of [["/api/finance", "GET"], ["/api/finance/receipt/analyze", "POST"]]) {
      const response = await app.request(path, { method, headers: { ...headers, "X-Expected-Roommate-Id": "stadlmann" } }, bindings());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "identity_changed" });
    }
    const denied = await app.request("/api/session", { headers: { "X-Expected-Roommate-Id": "kran" } }, bindings());
    expect(denied.status).toBe(403); // concurrency marker is not authentication
  });
});
