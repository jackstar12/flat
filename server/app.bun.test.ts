import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { roommateIds } from "../src/shared/config";
import { weekdayOfDate } from "../src/shared/tasks";
import { app } from "./app";
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
    PROXY_TOKEN: proxyToken,
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
  test("identity spoofing cannot replace private proof", async () => {
    for (const token of ["", "b".repeat(64), `${proxyToken}, ${proxyToken}`]) {
      expect((await send("/api/finance", { "X-Flat-Proxy-Token": token, Cookie: await loginCookie() })).status).toBe(401);
    }
    expect((await app.request("/healthz", {}, bindings())).status).toBe(200);
    expect((await app.request("/healthz", { method: "POST" }, bindings())).status).toBe(401);
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
