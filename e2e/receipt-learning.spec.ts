import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.E2E_LEARNING_PORT ?? Number(process.env.E2E_PORT ?? 4387) + 2}`;
test.use({ baseURL: origin, extraHTTPHeaders: { Origin: origin, "X-Flat-Proxy-Token": "a".repeat(64), "X-Flat-Email": "owner@example.test", "X-Flat-Uid": "fixture-owner" } });
async function start(page: Page, product: string, source: string, file = false) {
  await page.getByRole("button", { name: "Rechnung analysieren", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Rechnungstext" }).click();
  await page.getByLabel("Rechnungstext").fill(`TEST_PRODUCT=${product}\nBELEG=${source}`);
  if (file) await page.getByLabel("Rechnung (Bild oder PDF)").setInputFiles("e2e/fixtures/synthetic-receipt.png");
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vorschlag" })).toBeFocused();
}
async function correct(page: Page, product: string) {
  await page.getByLabel(`${product}: Kran in Euro`).fill("3.00");
  await page.getByLabel(`${product}: Stadlmann in Euro`).fill("0");
  await page.getByLabel(`${product}: Mitter in Euro`).fill("0");
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Als Ausgabe speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("saved corrections learn across reload; unchanged and abandoned receipts do not; reset lasts", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const product = `Lernkakao ${info.project.name}`;
  let ruleWrites = 0;
  await page.route("**/api/receipt-rules", async (route) => { if (route.request().method() === "PUT") ruleWrites++; await route.continue(); });
  await page.goto("/");
  await start(page, product, "abandoned"); await correct(page, product);
  await page.getByLabel("Schliessen", { exact: true }).click();
  await start(page, product, "unchanged"); await save(page);
  expect((await (await page.request.get("/api/receipt-learning")).json()).products.filter((p: { key: string }) => p.key === product.toLowerCase())).toEqual([]);
  for (let i = 0; i < 2; i++) {
    await start(page, product, `independent ${i}`); await correct(page, product); await save(page); await page.reload();
  }
  await start(page, product, "next analysis");
  await expect(page.getByLabel(`${product}: Kran in Euro`)).toHaveValue("3.00");
  await expect(page.getByText("Aus 2 bisherigen Korrekturen der WG vorgeschlagen. Bitte prüfen.")).toBeVisible();
  await page.locator("summary").filter({ hasText: "Vorschläge & Lernen" }).click();
  const entry = page.getByRole("region", { name: "Gelernte Aufteilungen" }).locator("article").filter({ hasText: product });
  await expect(entry).toContainText("2 Belege");
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("learned-preferences.png") });
  await entry.getByRole("button", { name: "Lernstand zurücksetzen" }).click();
  await expect(entry).toContainText("0 Belege");
  await page.reload();
  await start(page, product, "after reset");
  await expect(page.getByLabel(`${product}: Kran in Euro`)).toHaveValue("1.00");
  expect(ruleWrites).toBe(0);
});

test("failed original upload retries only PUT and finalizes evidence once", async ({ page }, info) => {
  const product = `Uploadprobe ${info.project.name}`;
  let posts = 0; let puts = 0;
  await page.route("**/api/finance/expenses", async (route) => { if (route.request().method() === "POST") posts++; await route.continue(); });
  await page.route("**/receipt-file", async (route) => {
    if (route.request().method() === "PUT") { puts++; if (puts === 1) return route.fulfill({ status: 503, json: { error: "Upload unterbrochen" } }); }
    await route.continue();
  });
  await page.goto("/"); await start(page, product, "with original", true); await correct(page, product);
  await page.getByRole("button", { name: "Als Ausgabe speichern" }).click();
  await expect(page.getByRole("alert")).toContainText("Upload unterbrochen");
  await expect(page.getByLabel(`${product}: Kran in Euro`)).toBeDisabled();
  expect((await (await page.request.get("/api/receipt-learning")).json()).products.some((p: { key: string }) => p.key === product.toLowerCase())).toBe(false);
  await page.getByRole("button", { name: "Originalbeleg erneut hochladen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts).toBe(1); expect(puts).toBe(2);
  const state = await (await page.request.get("/api/receipt-learning")).json();
  expect(state.products.find((p: { key: string }) => p.key === product.toLowerCase()).evidenceCount).toBe(1);
});

test("rejected saves stay editable and lost POST responses retry idempotently", async ({ page }, info) => {
  const product = `Antwortprobe ${info.project.name}`;
  let mode = "reject";
  await page.route("**/api/finance/expenses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (mode === "reject") { mode = "lost"; return route.fulfill({ status: 400, json: { error: "Bitte Beschreibung prüfen" } }); }
    if (mode === "lost") {
      mode = "retry";
      const response = await route.fetch(); expect(response.status()).toBe(201);
      return route.fulfill({ status: 503, json: { error: "Antwort unterbrochen" } });
    }
    await route.continue();
  });
  await page.goto("/");
  const before = (await (await page.request.get("/api/finance")).json()).transactions.length;
  await start(page, product, "uncertain response"); await correct(page, product);
  await page.getByRole("button", { name: "Als Ausgabe speichern" }).click();
  await expect(page.getByRole("alert")).toContainText("Bitte Beschreibung prüfen");
  await expect(page.getByLabel("Beschreibung", { exact: true })).toBeEnabled();
  await page.getByLabel("Beschreibung", { exact: true }).fill("Geprüfter Testbeleg");
  await page.getByRole("button", { name: "Als Ausgabe speichern" }).click();
  await expect(page.getByRole("alert")).toContainText("Antwort unterbrochen");
  await expect(page.getByLabel("Beschreibung", { exact: true })).toBeDisabled();
  await save(page);
  const after = (await (await page.request.get("/api/finance")).json()).transactions.length;
  expect(after).toBe(before + 1);
  const state = await (await page.request.get("/api/receipt-learning")).json();
  expect(state.products.find((p: { key: string }) => p.key === product.toLowerCase()).evidenceCount).toBe(1);
});
