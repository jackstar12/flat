import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { roommateIds } from "../src/shared/config";
import { weekdayOfDate } from "../src/shared/tasks";
import { app } from "./app";
import { parseTrustedOrigins } from "./config";
import { LocalDatabase } from "./db";

let database: LocalDatabase;
const proxyToken = "a".repeat(64);
const secret = "test-session-secret";
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
  const response = await app.request(
    "/api/login",
    {
      method: "POST",
      headers: { "X-Flat-Proxy-Token": proxyToken, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ roommateId: roommateIds[0] }),
    },
    bindings(),
  );
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function request(path: string, cookie: string, body: unknown, method = "POST"): Promise<Response> {
  return await app.request(
    path,
    {
      method,
      headers: { "X-Flat-Proxy-Token": proxyToken, Origin: origin, "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    },
    bindings(),
  );
}

function bindings() {
  return {
    DB: database,
    PROXY_TOKEN: proxyToken,
    SESSION_SECRET: secret,
    TRUSTED_ORIGINS: [origin, "https://flat.public.test", "https://flat.private.test:8787"],
    analyzeReceipt: async () => {
      throw new Error("Receipt analysis is not used in API tests.");
    },
  };
}


describe("public ingress security", () => {
  const loginBody = JSON.stringify({ roommateId: roommateIds[0] });
  function send(path: string, method: string, requestOrigin?: string, extra: Record<string, string> = {}, body?: string) {
    return app.request(`http://127.0.0.1:8787${path}`, {
      method,
      headers: { "X-Flat-Proxy-Token": proxyToken, "Content-Type": "application/json", ...(requestOrigin === undefined ? {} : { Origin: requestOrigin }), ...extra },
      body,
    }, bindings());
  }

  test("sets Secure cookies behind HTTP proxy for both configured HTTPS origins", async () => {
    for (const trusted of ["https://flat.public.test", "https://flat.private.test:8787"]) {
      const response = await send("/api/login", "POST", trusted, { "X-Forwarded-Proto": "http" }, loginBody);
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("; Secure");
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
      const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
      const session = await send("/api/session", "GET", undefined, { Cookie: cookie });
      expect(await session.json()).toMatchObject({ authenticated: true });
      const logout = await send("/api/logout", "POST", trusted, { Cookie: cookie });
      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("; Secure");
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    }
  });

  test("HTTP test origin ignores spoofed forwarding headers for cookie security", async () => {
    const response = await send("/api/login", "POST", origin, { "X-Forwarded-Proto": "https", Forwarded: "proto=https;host=flat.public.test" }, loginBody);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).not.toContain("; Secure");
  });

  test("rejects absent, null, malformed and non-exact origins before unsafe API handlers", async () => {
    const cookie = await loginCookie();
    for (const untrusted of [undefined, "null", "https://evil.test", "https://flat.public.test.evil.test", "https://flat.public.test/", "http://flat.public.test", "https://flat.private.test", "https://flat.public.test, https://evil.test"]) {
      for (const [path, method] of [["/api/login", "POST"], ["/api/logout", "POST"], ["/api/tasks", "POST"], ["/api/tasks/missing", "PATCH"], ["/api/finance/expenses/missing/receipt-file", "PUT"], ["/api/tasks/missing", "DELETE"]]) {
        const response = await send(path, method, untrusted, { Cookie: cookie, "X-Forwarded-Host": "flat.public.test", "X-Forwarded-Proto": "https" }, loginBody);
        expect(response.status).toBe(403);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
    expect((await send("/healthz", "GET")).status).toBe(200);
    expect((await send("/api/session", "GET")).status).toBe(200);
    expect((await send("/api/tasks", "GET", undefined, { Cookie: cookie })).status).toBe(200);
  });

  test("globally bounds login attempts including malformed bodies and successful logins", async () => {
    for (let i = 0; i < 30; i++) {
      const body = i === 0 ? loginBody : i === 1 ? "{}" : JSON.stringify({ roommateId: "unknown-roommate" });
      const response = await send("/api/login", "POST", origin, { "X-Forwarded-For": `192.0.2.${i}`, "CF-Connecting-IP": `192.0.2.${i}` }, body);
      expect(response.status).toBe(i === 0 ? 200 : 400);
    }
    const blocked = await send("/api/login", "POST", "https://flat.private.test:8787", { "X-Forwarded-For": "203.0.113.1" }, loginBody);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("900");
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect((await send("/api/session", "GET")).status).toBe(200);
    setSystemTime(testTime + 899_000);
    expect((await send("/api/login", "POST", origin, {}, loginBody)).headers.get("Retry-After")).toBe("1");
    setSystemTime(testTime + 900_000);
    expect((await send("/api/login", "POST", origin, {}, loginBody)).status).toBe(200);
  });
});


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

describe("private proxy proof", () => {
  test("requires proof even with a valid roommate cookie; rejects spoofed and joined headers", async () => {
    const cookie = await loginCookie();
    for (const token of [undefined, "", "b".repeat(64), proxyToken + ", " + proxyToken, "a".repeat(63)]) {
      for (const path of ["/api/session", "/api/finance", "/api/logout", "/api/login"]) {
        const response = await app.request(path, {
          method: path.endsWith("login") || path.endsWith("logout") ? "POST" : "GET",
          headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json",
            "X-Authentik-Username": "admin", ...(token === undefined ? {} : { "X-Flat-Proxy-Token": token }) },
        }, bindings());
        expect(response.status).toBe(401);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
    expect((await app.request("/healthz", {}, bindings())).status).toBe(200);
    expect((await app.request("/healthz", { method: "POST" }, bindings())).status).toBe(401);
  });

  test("selects a roommate without a password only after proof; retains session authorization", async () => {
    const headers = { Origin: origin, "Content-Type": "application/json", "X-Flat-Proxy-Token": proxyToken };
    expect((await app.request("/api/finance", { headers }, bindings())).status).toBe(401);
    const login = await app.request("/api/login", { method: "POST", headers,
      body: JSON.stringify({ roommateId: roommateIds[1] }) }, bindings());
    expect(login.status).toBe(200);
    const session = await app.request("/api/session", { headers: { ...headers, Cookie: login.headers.get("set-cookie")!.split(";")[0] } }, bindings());
    expect(await session.json()).toMatchObject({ authenticated: true, roommate: { id: roommateIds[1] } });
  });
});
