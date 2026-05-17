import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Person").selectOption("anna");
  await page.getByLabel("WG-Passwort").fill("flatastic");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Finanzen" })).toBeVisible();
});

test("creates and deletes an expense", async ({ page }, testInfo) => {
  const expenseName = `Playwright Expense ${testInfo.project.name}`;

  await page.getByRole("button", { name: "Ausgabe" }).click();
  await page.getByLabel("Beschreibung").fill(expenseName);
  await page.getByLabel("Betrag").fill("12,00");
  await page.getByRole("button", { name: "Speichern" }).click();

  const row = page.locator("article").filter({ hasText: expenseName });
  await expect(row).toBeVisible();
  await expect(page.getByText("Ben zahlt")).toBeVisible();

  await row.getByTitle("Loschen").click();
  await expect(row).toHaveCount(0);
});

test("creates, completes, and deletes a rotating chore", async ({ page }, testInfo) => {
  const choreName = `Playwright Chore ${testInfo.project.name}`;

  await page.getByRole("button", { name: "Aufgaben" }).click();
  await page.getByRole("button", { name: "Aufgabe", exact: true }).click();
  await page.getByLabel("Titel").fill(choreName);
  await page.getByRole("button", { name: "Speichern" }).click();

  const row = page.locator("article").filter({ hasText: choreName });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Erledigt" }).click();
  await expect(row.getByText("Ben")).toBeVisible();

  await row.getByTitle("Loschen").click();
  await expect(row).toHaveCount(0);
});
