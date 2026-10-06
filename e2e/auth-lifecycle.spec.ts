import { expect, test } from "@playwright/test";
const origin = `http://127.0.0.1:${process.env.E2E_AUTH_PROXY_PORT ?? Number(process.env.E2E_PORT ?? 4387) + 3}`;
test.use({ baseURL: origin, extraHTTPHeaders: {} });
test.skip(!process.env.FLAT_TEST_PROXY_SNIPPET, "Explicit canonical Caddy fixture required");
const login = "/outpost.goauthentik.io/fixture-login";

test("real Caddy preserves refresh, exact Origin, identity proof and multipart slash routes", async ({ request }) => {
  for (const path of ["/api", "/api/receipts", "/api/receipts/"]) {
    const response = await request.get(path, { maxRedirects: 0, headers: { "X-Flat-Email": "owner@example.test", "X-Flat-Uid": "fixture-owner", "X-Flat-Proxy-Token": "a".repeat(64) } });
    expect(response.status()).toBe(401); expect(response.headers().location).toBeUndefined();
  }
  await request.get(login);
  const session = await request.get("/api/session");
  expect((await session.json()).roommate.id).toBe("kran");
  expect(session.headers()["set-cookie"]).toContain("refresh_fixture=renewed");
  for (const path of ["/api/finance/receipt/analyze", "/api/finance/receipt/analyze/"]) {
    for (const value of [undefined, "null", "https://evil.example", `${origin}/`, origin]) {
      const response = await request.post(path, { headers: value ? { Origin: value } : {}, multipart: { receiptText: "" }, maxRedirects: 0 });
      expect(response.status()).toBe(value === origin ? 400 : 403);
      expect(response.headers().location).toBeUndefined();
    }
  }
  for (const path of ["/api/receipts", "/api/receipts/"]) {
    const response = await request.get(path); expect(response.status()).toBe(404); expect((await response.json()).code).toBe("not_found");
  }
  await request.get(`${login}?actor=stadlmann`);
  const mismatch = await request.post("/api/finance/receipt/analyze", { headers: { Origin: origin, "X-Expected-Roommate-Id": "kran" }, multipart: { receiptText: "" } });
  expect(mismatch.status()).toBe(409); expect((await mismatch.json()).code).toBe("identity_changed");
  await request.get(`${login}?actor=unmapped`);
  expect((await request.get("/api/session")).status()).toBe(403);
});

test("native re-login in another tab keeps a draft in memory and never repeats the failed action", async ({ page, context }) => {
  await context.request.get(login); await page.goto("/");
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await page.getByLabel("Beschreibung").fill("Draft stays only in memory");
  await page.getByLabel("Betrag", { exact: true }).fill("12,00");
  let mutations = 0;
  page.on("request", (request) => { if (request.method() === "POST") mutations++; });
  await context.request.get("/outpost.goauthentik.io/fixture-expire");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("nicht automatisch wiederholt");
  const popupPromise = context.waitForEvent("page");
  await dialog.getByRole("link", { name: "Erneut anmelden" }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Synthetic sign-in" })).toBeVisible();
  await context.request.get(login); await popup.goto("/?reauth=1");
  await expect(popup.getByRole("heading", { name: /Angemeldet als/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Anmeldung prüfen" }).click();
  await expect(dialog.getByRole("link", { name: "Erneut anmelden" })).toHaveCount(0);
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Draft stays only in memory");
  expect(mutations).toBe(1);
  expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, caches: await caches.keys(), dbs: await indexedDB.databases() }))).toEqual({ local: 0, session: 0, caches: [], dbs: [] });
  await popup.close();
});

test("account changes discard prior drafts and logout removes private UI before leaving", async ({ page, context }) => {
  await context.request.get(login); await page.goto("/");
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await page.getByLabel("Beschreibung").fill("Old account private draft");
  await context.request.get(`${login}?actor=stadlmann`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".app-identity")).toContainText("Stadlmann");
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await expect(page.getByLabel("Beschreibung")).toHaveValue("");
  await page.getByRole("dialog").getByRole("button", { name: "Schliessen", exact: true }).click();
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/outpost.goauthentik.io/sign_out`);
  expect((await context.request.get("/api/session")).status()).toBe(401);
  await page.goBack();
  await expect(page.getByText("Old account private draft")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Synthetic sign-in" })).toBeVisible();
});

test("receipt reauthentication retains the selected file and text without repeating analysis", async ({ page, context }) => {
  await context.request.get(login); await page.goto("/");
  await page.getByRole("button", { name: "Rechnung analysieren", exact: true }).click();
  await page.getByLabel("Rechnung (Bild oder PDF)").setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("Synthetic draft; never sent to inference") });
  await page.getByLabel("Beschreibung", { exact: true }).fill("Receipt draft");
  await context.request.get("/outpost.goauthentik.io/fixture-expire");
  let requests = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/receipt/analyze")) requests++; });
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Anmeldung erforderlich");
  await context.request.get(login);
  await dialog.getByRole("button", { name: "Anmeldung prüfen" }).click();
  await expect(dialog.getByRole("link", { name: "Erneut anmelden" })).toHaveCount(0);
  await expect(page.getByLabel("Beschreibung", { exact: true })).toHaveValue("Receipt draft");
  await expect(dialog.getByText("synthetic.pdf", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  // Only an explicit click may submit again. Inspect the retained File bytes
  // without invoking inference or creating a financial record.
  await page.route("**/api/finance/receipt/analyze", async (route) => {
    expect(route.request().postDataBuffer()?.includes(Buffer.from("Synthetic draft; never sent to inference"))).toBe(true);
    await route.fulfill({ status: 502, json: { error: "Synthetic service failure", code: "inference_unavailable" } });
  });
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Synthetic service failure");
  await expect(dialog.getByRole("link", { name: "Erneut anmelden" })).toHaveCount(0);
  expect(requests).toBe(2);
});

test("a transient read rejection recovers without showing login or losing a draft", async ({ page, context }) => {
  await context.request.get(login); await page.goto("/");
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await page.getByLabel("Beschreibung").fill("Keep this draft through recovery");
  let reads = 0;
  await page.route("**/api/finance", async route => {
    reads++;
    if (reads === 1) await route.fulfill({ status: 401, json: { error: "Authentication required" } });
    else await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator(".global-auth-alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Erneut anmelden" })).toHaveCount(0);
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Keep this draft through recovery");
});
