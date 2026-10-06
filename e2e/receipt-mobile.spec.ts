import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ReceiptAnalysis } from "../src/shared/types";

const original = readFileSync(new URL("./fixtures/synthetic-receipt.png", import.meta.url));
const analysis: ReceiptAnalysis = {
  merchant: "Wolkenmarkt", receiptDate: "2026-10-05", totalCents: 601, warnings: [],
  items: [
    { name: "Bio-Äpfel", normalizedName: "Apfel", category: "Obst", quantity: "1", amountCents: 301,
      assignmentReason: "Gemeinsamer Einkauf", splits: [{ roommateId: "kran", amountCents: 301 }] },
    { name: "Hafermilch", normalizedName: "Hafermilch", category: "Milchprodukte", quantity: "2", amountCents: 300,
      assignmentReason: "Gemeinsamer Einkauf", splits: [{ roommateId: "stadlmann", amountCents: 300 }] },
  ],
  roommateTotals: [{ roommateId: "kran", amountCents: 301 }, { roommateId: "stadlmann", amountCents: 300 }],
};

async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Rechnung analysieren", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeFocused();
}
async function upload(page: Page, name = "synthetischer-beleg.png") {
  await page.getByLabel("Rechnung (Bild oder PDF)").setInputFiles({ name, mimeType: "image/png", buffer: original });
}
async function noOverflow(page: Page) {
  expect(await page.getByRole("dialog").evaluate((dialog) => {
    const visible = [dialog, ...dialog.querySelectorAll("*")].filter((el) => el.checkVisibility());
    return visible.filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== "inline" && getComputedStyle(el).overflowX === "visible")
      .map((el) => `${el.tagName}.${el.className}`);
  })).toEqual([]);
}

for (const width of [320, 390, 1280]) {
  test(`receipt upload, review and single save at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    let analysisCalls = 0;
    let saves = 0;
    let attachments = 0;
    let releaseAnalysis!: () => void;
    const analysisGate = new Promise<void>((resolve) => { releaseAnalysis = resolve; });
    await page.route("**/api/finance/receipt/analyze", async (route) => {
      analysisCalls++;
      expect(route.request().postDataBuffer()!.includes(original)).toBe(true);
      await analysisGate;
      await route.fulfill({ json: { analysis } });
    });
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    await page.route("**/api/finance/expenses", async (route) => {
      saves++;
      const body = route.request().postDataJSON();
      expect(body.paidBy).toBe("kran");
      expect(body.receiptItems[0].splits.map((s: { amountCents: number }) => s.amountCents)).toEqual([101, 100, 100]);
      await saveGate;
      await route.fulfill({ json: { transaction: { id: "synthetic-mobile" } } });
    });
    await page.route("**/api/finance/expenses/synthetic-mobile/receipt-file", async (route) => {
      attachments++;
      expect(route.request().postDataBuffer()!.includes(original)).toBe(true);
      await route.fulfill({ json: { ok: true } });
    });
    await open(page);
    await expect(page.getByRole("button", { name: "Analysieren", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Rechnungstext")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Regeln" })).toBeHidden();
    await expect(page.getByLabel("Foto aufnehmen", { exact: true })).toHaveAttribute("capture", "environment");
    await upload(page, "Ein-sehr-langer-synthetischer-Originalbeleg-für-die-Wohngemeinschaft.png");
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`receipt-${width}-upload.png`) });
    await page.getByRole("button", { name: "Analysieren", exact: true }).evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
    await expect(page.getByRole("button", { name: "Analysiere...", exact: true })).toBeDisabled();
    await expect.poll(() => analysisCalls).toBe(1);
    releaseAnalysis();
    await expect(page.getByRole("heading", { name: "Vorschlag" })).toBeFocused();
    await page.getByRole("button", { name: "Zu dritt teilen" }).first().click();
    const amount = page.getByLabel("Bio-Äpfel: Kran in Euro");
    await expect(amount).toHaveValue("1.01");
    await amount.fill("0.50");
    await expect(page.getByRole("button", { name: "Als Ausgabe speichern" })).toBeDisabled();
    await amount.fill("1.01");
    await expect(page.getByRole("button", { name: "Als Ausgabe speichern" })).toBeEnabled();
    await noOverflow(page);
    expect(await amount.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect((await amount.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("heading", { name: "Vorschlag" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`receipt-${width}-review.png`) });
    const save = page.getByRole("button", { name: "Als Ausgabe speichern" });
    expect((await save.boundingBox())!.y + (await save.boundingBox())!.height).toBeLessThanOrEqual(844);
    await save.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
    await expect(page.getByRole("button", { name: "Speichert...", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Schliessen", { exact: true })).toBeDisabled();
    releaseSave();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(saves).toBe(1);
    expect(attachments).toBe(1);
    await expect(page.getByRole("button", { name: "Rechnung analysieren", exact: true })).toBeFocused();
  });
}

test("changed sources invalidate results; errors, empty analysis and expiry retain the draft", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  let mode = "success";
  await page.route("**/api/finance/receipt/analyze", async (route) => {
    if (mode === "error") return route.fulfill({ status: 503, json: { error: "Analyse nicht erreichbar. Bitte erneut versuchen." } });
    if (mode === "expired") return route.fulfill({ status: 401, json: { error: "expired" } });
    await route.fulfill({ json: { analysis: mode === "empty" ? { ...analysis, totalCents: 0, items: [], roommateTotals: [] } : analysis } });
  });
  await open(page);
  await upload(page);
  await page.getByLabel("Beschreibung", { exact: true }).fill("Mein Entwurf");
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vorschlag" })).toBeFocused();
  await page.getByRole("button", { name: "1 · Beleg wählen" }).click();
  await upload(page, "anderer-beleg.png");
  await expect(page.getByRole("button", { name: "2 · Prüfen & teilen" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Als Ausgabe speichern" })).toHaveCount(0);
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vorschlag" })).toBeFocused();
  await page.getByRole("button", { name: "1 · Beleg wählen" }).click();
  await page.locator("summary").filter({ hasText: "Rechnungstext" }).click();
  await page.getByLabel("Rechnungstext").fill("Korrigierter Text");
  await expect(page.getByRole("button", { name: "2 · Prüfen & teilen" })).toBeDisabled();
  mode = "error";
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Analyse nicht erreichbar");
  mode = "empty";
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(page.getByText(/Keine Positionen erkannt/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Als Ausgabe speichern" })).toBeDisabled();
  await page.getByRole("button", { name: "1 · Beleg wählen" }).click();
  mode = "expired";
  await page.route("**/api/session", route => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Erneut anmelden" })).toBeVisible();
  await expect(page.getByLabel("Beschreibung", { exact: true })).toHaveValue("Mein Entwurf");
  await expect(page.getByLabel("Rechnungstext")).toHaveValue("Korrigierter Text");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("PDF choice, rules disclosure and keyboard navigation fit 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const pdf = Buffer.from("%PDF-1.4 synthetic receipt for UI regression");
  await page.route("**/api/finance/receipt/analyze", async (route) => {
    expect(route.request().postDataBuffer()!.includes(pdf)).toBe(true);
    await route.fulfill({ json: { analysis } });
  });
  await open(page);
  await page.getByLabel("Rechnung (Bild oder PDF)").setInputFiles({ name: "beleg.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.locator("summary").filter({ hasText: "Zuordnungsregeln" }).click();
  await page.getByRole("button", { name: "Regel", exact: true }).click();
  await noOverflow(page);
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vorschlag" })).toBeFocused();
  await page.getByRole("button", { name: "Als Ausgabe speichern" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Schliessen", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Als Ausgabe speichern" })).toBeFocused();
  await page.getByRole("button", { name: "1 · Beleg wählen" }).click();
  await page.getByRole("button", { name: "Regel", exact: true }).click();
  await page.getByLabel("Regelbegriff").fill("Synthetische Regel");
  await page.getByRole("button", { name: "Ubernehmen", exact: true }).click();
  await expect(page.getByRole("button", { name: "2 · Prüfen & teilen" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
