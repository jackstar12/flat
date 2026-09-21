import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = `http://127.0.0.1:${process.env.E2E_PWA_PORT ?? Number(process.env.E2E_PORT ?? 4387) + 1}`;
const test = base.extend({
  context: async ({ playwright, launchOptions, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent }, use) => {
    // A fresh regular profile: Chromium deliberately disallows installation in
    // incognito contexts. No identity/proxy headers or production profile.
    const profile = await mkdtemp(join(tmpdir(), "flat-pwa-profile-"));
    const context = await playwright.chromium.launchPersistentContext(profile, {
      ...launchOptions, headless: true, baseURL: origin, serviceWorkers: "allow", extraHTTPHeaders: {},
      viewport, isMobile, hasTouch, deviceScaleFactor, userAgent,
    });
    try {
      await context.request.post("/__test/state", { data: { reset: true } });
      await use(context);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
});

async function enter(page: Page) {
  await page.request.get("/__test/login");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hugo Wolfgang", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Finanzen", exact: true })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
}

async function noPrivateStorage(page: Page) {
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration ? registration.pushManager.getSubscription() : null;
  })).toBeNull();
  expect(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration() as
      (ServiceWorkerRegistration & { sync?: { getTags(): Promise<string[]> } }) | undefined;
    return registration?.sync ? registration.sync.getTags() : [];
  })).toEqual([]);
}

async function state(context: BrowserContext) {
  return (await context.request.get("/__test/state")).json();
}

test("authenticated manifest, decoded icons, root control and browser installability", async ({ page, context }, testInfo) => {
  await enter(page);
  await expect(page).toHaveTitle("Hugo Wolfgang");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("crossorigin", "use-credentials");
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", name: "Hugo Wolfgang", short_name: "Hugo Wolfgang", display: "standalone", theme_color: "#f7f8f4", background_color: "#f7f8f4" });
  expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBe(manifest.theme_color);
  expect(manifest.icons).toEqual([
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  for (const icon of [...manifest.icons, { src: apple, sizes: "180x180" }]) {
    const imageResponse = await page.request.get(icon.src);
    expect(imageResponse.headers()["content-type"]).toContain("image/png");
    expect((await imageResponse.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(await page.evaluate(async (src) => {
      const image = new Image(); image.src = src; await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, icon.src)).toBe(icon.sizes);
  }
  for (const [path, mime] of [["/sw.js", "text/javascript"], ["/manifest.webmanifest", "application/manifest+json"]]) {
    const head = await page.request.head(path);
    expect(head.headers()["content-type"]).toContain(mime);
    expect(head.headers()["cache-control"]).toContain("no-store");
    expect(head.headers()["x-content-type-options"]).toBe("nosniff");
  }
  expect(await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active?.scriptURL, cache: r.updateViaCache };
  })).toEqual({ scope: `${origin}/`, script: `${origin}/sw.js`, cache: "none" });

  const cdp = await context.newCDPSession(page);
  const browserManifest = await cdp.send("Page.getAppManifest");
  expect(browserManifest.errors).toEqual([]);
  expect(JSON.parse(browserManifest.data!)).toEqual(manifest);
  const installability = await cdp.send("Page.getInstallabilityErrors");
  const evidence = testInfo.outputPath("installability.json");
  await writeFile(evidence, JSON.stringify({ browserManifest, installability }, null, 2));
  await testInfo.attach("Chromium installability", { path: evidence, contentType: "application/json" });
  expect(installability.installabilityErrors).toEqual([]);
  expect((await state(context)).manifestCookieRequests).toBeGreaterThan(0);
  await noPrivateStorage(page);
});

test("anonymous install resources remain gated and no worker is installed", async ({ page, context }) => {
  for (const path of ["/", "/sw.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"]) {
    const response = await context.request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe("/outpost.goauthentik.io/start");
    const backend = `http://127.0.0.1:${process.env.E2E_PORT ?? 4387}`;
    expect((await context.request.get(`${backend}${path}`)).status()).toBe(401);
  }
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Synthetic sign-in" })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
  await noPrivateStorage(page);
});

test("initial worker auth failure is harmless and retries after login", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.request.post("/__test/state", { data: { scriptMode: "redirect" } });
  await context.request.get("/__test/login");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Finanzen", exact: true })).toBeVisible();
  await expect.poll(async () => (await state(context)).scriptRequests).toBeGreaterThan(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await context.request.post("/__test/state", { data: { scriptMode: "v1" } });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  expect(errors).toEqual([]);
  await noPrivateStorage(page);
});

test("an unreachable login redirect destination never becomes the offline app", async ({ page, context }) => {
  await enter(page);
  await context.request.get("/__test/expire");
  await page.route("**/outpost.goauthentik.io/start", (route) => route.abort("connectionfailed"));
  await expect(page.goto("/")).rejects.toThrow();
  await expect(page.getByText("keine persönlichen Daten offline verfügbar", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hugo Wolfgang", exact: true })).toHaveCount(0);
});

test("expired mutation preserves draft, login redirect and 401 stay network responses", async ({ page, context }) => {
  await enter(page);
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await page.getByLabel("Beschreibung").fill("Private unsaved PWA draft");
  await page.getByLabel("Betrag", { exact: true }).fill("12,00");
  await context.request.get("/__test/expire");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("nicht automatisch wiederholt");
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Private unsaved PWA draft");
  expect((await state(context)).mutationRequests).toBe(1);
  await noPrivateStorage(page);
  await page.getByRole("link", { name: "Erneut anmelden" }).click();
  await expect(page).toHaveURL(`${origin}/outpost.goauthentik.io/start`);
  await expect(page.getByRole("heading", { name: "Synthetic sign-in" })).toBeVisible();
  await expect(page.getByText("Private unsaved PWA draft")).toHaveCount(0);
  await noPrivateStorage(page);
  await context.request.get("/__test/login");
  for (const status of [401, 503]) {
    await context.request.post("/__test/state", { data: { navigationStatus: status } });
    expect((await page.goto("/"))?.status()).toBe(status);
    await expect(page.locator("body")).toHaveText("Gate response");
  }
  await context.request.post("/__test/state", { data: { navigationStatus: 200 } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Finanzen", exact: true })).toBeVisible();
  expect((await state(context)).mutationRequests).toBe(1);
  await noPrivateStorage(page);
});

test("offline entry is generic, API and mutations fail without storage or replay", async ({ page, context }) => {
  await enter(page);
  await context.setOffline(true);
  expect(await page.evaluate(async () => {
    const results = [];
    for (const [path, method] of [["/api/finance", "GET"], ["/api/finance/expenses", "POST"], ["/api/account", "GET"]]) {
      try { await fetch(path, { method, body: method === "POST" ? "synthetic offline mutation" : undefined }); results.push("response"); }
      catch { results.push("network-error"); }
    }
    return results;
  })).toEqual(["network-error", "network-error", "network-error"]);
  const offline = await page.goto("/");
  expect(offline?.status()).toBe(503);
  expect(offline?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Hugo Wolfgang", exact: true })).toHaveCount(1);
  await expect(page.locator("body")).toContainText("keine persönlichen Daten offline verfügbar");
  await expect(page.locator("body")).not.toContainText("Gesamtausgaben");
  await expect(page.locator("script, form, img")).toHaveCount(0);
  await noPrivateStorage(page);
  await context.setOffline(false);
  await page.getByRole("link", { name: "Erneut versuchen" }).click();
  await expect(page.getByRole("heading", { name: "Finanzen", exact: true })).toBeVisible();
  expect((await state(context)).mutationRequests).toBe(0);
  await noPrivateStorage(page);
});

test("worker updates activate without reload; auth redirect, HTML and 401 failures retain the worker", async ({ page, context }) => {
  await enter(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await page.getByLabel("Beschreibung").fill("Draft survives worker update");
  await page.evaluate(() => { Object.assign(window, { originalWorker: navigator.serviceWorker.controller }); });
  await context.request.post("/__test/state", { data: { scriptMode: "v2" } });
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== (window as unknown as { originalWorker: ServiceWorker }).originalWorker);
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Draft survives worker update");
  await page.evaluate(() => { Object.assign(window, { originalWorker: navigator.serviceWorker.controller }); });
  for (const scriptMode of ["redirect", "html", "401"]) {
    await context.request.post("/__test/state", { data: { scriptMode } });
    expect(await page.evaluate(async () => {
      try { await (await navigator.serviceWorker.ready).update(); return "unexpected success"; }
      catch { return "rejected"; }
    })).toBe("rejected");
    expect(await page.evaluate(() => navigator.serviceWorker.controller === (window as unknown as { originalWorker: ServiceWorker }).originalWorker)).toBe(true);
    await expect(page.getByLabel("Beschreibung")).toHaveValue("Draft survives worker update");
  }
  // Exercise the application's caught register/update retry, including recovery.
  const before = (await state(context)).scriptRequests;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await state(context)).scriptRequests).toBeGreaterThan(before);
  await context.request.post("/__test/state", { data: { scriptMode: "v3" } });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== (window as unknown as { originalWorker: ServiceWorker }).originalWorker);
  expect(errors).toEqual([]);
  await expect(page.getByLabel("Beschreibung")).toHaveValue("Draft survives worker update");
  await noPrivateStorage(page);
});
