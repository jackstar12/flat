import { expect, test, type Page } from "@playwright/test";
import { roommates } from "../src/shared/config";
import type { FinanceTransaction, ReceiptAnalysis, SessionPayload } from "../src/shared/types";

// These identities exist only in the Playwright server's synthetic mapping.
async function useRoommate(page: Page, index: number, baseURL: string) {
  const roommate = roommates[index];
  await page.setExtraHTTPHeaders({
    Origin: baseURL,
    "X-Flat-Proxy-Token": "a".repeat(64),
    "X-Flat-Email": index === 0 ? "owner@example.test" : `ui-${roommate.id}@example.test`,
    "X-Flat-Uid": index === 0 ? "fixture-owner" : `ui-${roommate.id}`,
  });
  return roommate;
}

async function saveExpense(page: Page, buttonName: string, method = "POST") {
  const response = page.waitForResponse((response) =>
    response.url().includes("/api/finance/expenses") && response.request().method() === method,
  );
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const saved = await response;
  expect(saved.ok()).toBeTruthy();
  return (await saved.json() as { transaction: FinanceTransaction }).transaction;
}

for (const [index, roommate] of roommates.entries()) {
  test(`delayed backend identity defaults new expenses to ${roommate.id}`, async ({ page, baseURL }, testInfo) => {
    await useRoommate(page, index, baseURL!);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/session", async (route) => {
      const response = await route.fetch();
      const session = await response.json() as SessionPayload;
      expect(session.authenticated).toBe(true);
      expect(session.roommate?.id).toBe(roommate.id);
      await gate;
      await route.fulfill({ response });
    });

    await page.goto("/");
    try {
      await expect(page.getByText("Laden...", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Ausgabe", exact: true })).toHaveCount(0);
    } finally {
      release();
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hugo Wolfgang");
    await expect(page.getByRole("heading", { name: "WG Cockpit", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
    await expect(page.getByLabel("Bezahlt von")).toHaveValue(roommate.id);
    await page.getByLabel("Beschreibung").fill(`Synthetic default ${index} ${testInfo.project.name}`);
    await page.getByLabel("Betrag", { exact: true }).fill("9,00");
    const saved = await saveExpense(page, "Speichern");
    expect(saved.paidBy).toBe(roommate.id);
    expect(saved.createdBy).toBe(roommate.id);
    await expect(page.getByLabel("Bezahlt von")).toHaveCount(0);

    // Successful saves and cancellation both start a fresh form.
    await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
    await expect(page.getByLabel("Beschreibung")).toHaveValue("");
    await expect(page.getByLabel("Bezahlt von")).toHaveValue(roommate.id);
    await page.getByLabel("Bezahlt von").selectOption(roommates[(index + 1) % roommates.length].id);
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
    await expect(page.getByLabel("Bezahlt von")).toHaveValue(roommate.id);
    await page.request.delete(`/api/finance/expenses/${saved.id}`);
  });
}

test("manual override survives other edits and saved payer survives reopening for edit", async ({ page, baseURL }, testInfo) => {
  const actor = await useRoommate(page, 2, baseURL!);
  const payer = roommates[1];
  const description = `Synthetic override ${testInfo.project.name}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(actor.id);
  await page.getByLabel("Bezahlt von").selectOption(payer.id);
  await page.getByLabel("Beschreibung").fill(description);
  await page.getByLabel("Betrag", { exact: true }).fill("12,00");
  await page.getByLabel("Datum").fill("2026-09-15");
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(payer.id);
  const saved = await saveExpense(page, "Speichern");
  expect(saved.paidBy).toBe(payer.id);
  expect(saved.createdBy).toBe(actor.id);
  await page.reload();

  const row = page.locator("article").filter({ hasText: description });
  await row.getByTitle("Bearbeiten", { exact: true }).click();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(payer.id);
  await page.getByLabel("Beschreibung").fill(`${description} edited`);
  const edited = await saveExpense(page, "Speichern", "PATCH");
  expect(edited.paidBy).toBe(payer.id);
  await expect(page.getByLabel("Bezahlt von")).toHaveCount(0);
  await row.getByTitle("Bearbeiten", { exact: true }).click();
  await page.getByLabel("Bezahlt von").selectOption(roommates[0].id);
  expect((await saveExpense(page, "Speichern", "PATCH")).paidBy).toBe(roommates[0].id);
  await expect(page.getByLabel("Bezahlt von")).toHaveCount(0);
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(actor.id);
  await page.request.delete(`/api/finance/expenses/${saved.id}`);
});

test("receipt creation defaults, preserves override during analysis, and resets on reopen", async ({ page, baseURL }, testInfo) => {
  const actor = await useRoommate(page, 1, baseURL!);
  const other = roommates[2];
  const analysis: ReceiptAnalysis = {
    merchant: "Synthetic shop", receiptDate: "2026-09-15", totalCents: 300, warnings: [],
    items: [{
      name: "Synthetic item", normalizedName: "Synthetic item", category: "Sonstiges", quantity: "1",
      amountCents: 300, assignmentReason: "Synthetic fixture",
      splits: [{ roommateId: actor.id, amountCents: 300 }],
    }],
    roommateTotals: [{ roommateId: actor.id, amountCents: 300 }],
  };
  let release!: () => void;
  let gate = Promise.resolve();
  await page.route("**/api/finance/receipt/analyze", async (route) => {
    await gate;
    await route.fulfill({ json: { analysis } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Rechnung analysieren", exact: true }).click();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(actor.id);
  await page.getByLabel("Beschreibung", { exact: true }).fill(`Synthetic receipt default ${testInfo.project.name}`);
  await page.getByLabel("Rechnungstext").fill("Synthetic item 3.00");
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  const savedDefault = await saveExpense(page, "Als Ausgabe speichern");
  expect(savedDefault.paidBy).toBe(actor.id);
  expect(savedDefault.createdBy).toBe(actor.id);
  await expect(page.getByLabel("Bezahlt von")).toHaveCount(0);

  await page.getByRole("button", { name: "Rechnung analysieren", exact: true }).click();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(actor.id);
  await expect(page.getByLabel("Rechnungstext")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Als Ausgabe speichern" })).toHaveCount(0);
  await page.getByLabel("Beschreibung", { exact: true }).fill(`Synthetic receipt override ${testInfo.project.name}`);
  await page.getByLabel("Rechnungstext").fill("Synthetic item 3.00");
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/synthetic-receipt.png");
  gate = new Promise<void>((resolve) => { release = resolve; });
  await page.getByRole("button", { name: "Analysieren", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "Analysiere...", exact: true })).toBeVisible();
    await page.getByLabel("Bezahlt von").selectOption(other.id);
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "Als Ausgabe speichern" })).toBeEnabled();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(other.id);
  const upload = page.waitForResponse((response) => response.url().endsWith("/receipt-file") && response.request().method() === "PUT");
  const savedOverride = await saveExpense(page, "Als Ausgabe speichern");
  expect(savedOverride.paidBy).toBe(other.id);
  expect(savedOverride.createdBy).toBe(actor.id);
  expect((await upload).ok()).toBeTruthy();
  await expect(page.getByLabel("Bezahlt von")).toHaveCount(0);
  await page.getByRole("button", { name: "Rechnung analysieren", exact: true }).click();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(actor.id);
  await page.getByLabel("Bezahlt von").selectOption(other.id);
  await page.getByRole("button", { name: "Schliessen", exact: true }).click();
  await page.getByRole("button", { name: "Rechnung analysieren", exact: true }).click();
  await expect(page.getByLabel("Bezahlt von")).toHaveValue(actor.id);
  await page.request.delete(`/api/finance/expenses/${savedDefault.id}`);
  await page.request.delete(`/api/finance/expenses/${savedOverride.id}`);
});
