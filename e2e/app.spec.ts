import { expect, test } from "@playwright/test";
import { roommates } from "../src/shared/config";

const [firstRoommate, secondRoommate] = roommates;
const roommateNames = roommates.map((roommate) => roommate.name);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Person").selectOption(firstRoommate.id);
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
  await expect(page.getByText(`${secondRoommate.name} zahlt`)).toBeVisible();

  await row.getByTitle("Loschen").click();
  await expect(row).toHaveCount(0);
});

test("opens the receipt analysis workflow", async ({ page }) => {
  await page.getByRole("button", { name: "Rechnung analysieren" }).click();

  await expect(page.getByRole("heading", { name: "Rechnung analysieren" })).toBeVisible();
  await expect(page.getByLabel("Essensregeln")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analysieren", exact: true })).toBeVisible();
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
  await expect(row.getByText(secondRoommate.name)).toBeVisible();

  await row.getByTitle("Loschen").click();
  await expect(row).toHaveCount(0);
});

test("advances the laundry rotation without a due date", async ({ page }) => {
  await page.getByRole("button", { name: "Aufgaben" }).click();

  const laundry = page.getByTestId("laundry-card");
  await expect(laundry.getByText("Keine feste Fälligkeit")).toBeVisible();

  const current = (await laundry.getByTestId("laundry-current").textContent()) ?? "";
  const next = roommateNames[(roommateNames.indexOf(current) + 1) % roommateNames.length];

  await laundry.getByRole("button", { name: "Wäsche erledigt" }).click();
  await expect(laundry.getByTestId("laundry-current")).toHaveText(next);
});
