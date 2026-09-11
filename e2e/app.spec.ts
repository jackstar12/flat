import { expect, test } from "@playwright/test";
import { roommates } from "../src/shared/config";

const [firstRoommate, secondRoommate] = roommates;
const roommateNames = roommates.map((roommate) => roommate.name);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Person").selectOption(firstRoommate.id);
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  await page.getByRole("button", { name: "Weiter" }).click();
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
  await expect(page.getByRole("heading", { name: "Regeln" })).toBeVisible();
  await expect(page.getByText("Griechischer Joghurt", { exact: true })).toBeVisible();
  await expect(page.getByText("Skyr", { exact: true })).toBeVisible();
  const berryRule = page.locator("article").filter({ hasText: "Beeren" });
  await expect(berryRule).toContainText("Kran 65%");
  await expect(berryRule).toContainText("Stadlmann 35%");
  await expect(page.getByRole("button", { name: "Analysieren", exact: true })).toBeVisible();
});

test("keeps the balance strip responsive", async ({ page }) => {
  const cards = page.getByTestId("balance-card");
  await expect(cards).toHaveCount(roommates.length);
  await expect(page.getByTestId("total-spent")).toContainText("Gesamtausgaben");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  const widths = await cards.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  }
});

test("shows parsed positions and the original receipt file", async ({ page }, testInfo) => {
  const description = `Receipt Details ${testInfo.project.name} ${Date.now()}`;
  const expenseResponse = await page.request.post("/api/finance/expenses", {
    data: {
      description,
      amountCents: 599,
      paidBy: firstRoommate.id,
      paidAt: "2026-08-31",
      splitMode: "custom",
      participantIds: [],
      splits: [{ roommateId: firstRoommate.id, owedCents: 599 }],
      receiptItems: [
        {
          name: "Test Position",
          normalizedName: "Testprodukt",
          category: "Sonstiges",
          quantity: "1 Packung",
          amountCents: 599,
          assignmentReason: "Testregel: vollständig Kran.",
          splits: [{ roommateId: firstRoommate.id, amountCents: 599 }],
        },
      ],
    },
  });
  expect(expenseResponse.ok()).toBeTruthy();
  const transaction = (await expenseResponse.json()) as { transaction: { id: string } };

  const uploadResponse = await page.request.put(`/api/finance/expenses/${transaction.transaction.id}/receipt-file`, {
    multipart: {
      receipt: {
        name: "original-rechnung.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 test receipt"),
      },
    },
  });
  expect(uploadResponse.ok()).toBeTruthy();

  await page.reload();
  const row = page.locator("article").filter({ hasText: description });
  await row.locator("summary").click();
  await expect(row.getByText("Testprodukt", { exact: true })).toBeVisible();
  await expect(row.getByText(/^Test Position/)).toBeVisible();
  await expect(row.getByText("Sonstiges", { exact: true })).toBeVisible();
  await expect(row.getByText("1 Packung", { exact: true })).toBeVisible();
  await expect(row.getByText("original-rechnung.pdf", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: /Original.*Öffnen/ })).toHaveAttribute(
    "href",
    `/api/finance/expenses/${transaction.transaction.id}/receipt-file`,
  );

  const tracking = page.getByRole("region", { name: "Warengruppen" });
  await expect(tracking.getByText("Sonstiges", { exact: true })).toBeVisible();
  await tracking.getByText("Generalisierte Produkte", { exact: true }).click();
  await expect(tracking.getByText("Testprodukt", { exact: true })).toBeVisible();

  await page.request.delete(`/api/finance/expenses/${transaction.transaction.id}`);
});

test("persists structured receipt rules", async ({ page }, testInfo) => {
  const ruleName = `Playwright Regel ${testInfo.project.name}`;
  await page.getByRole("button", { name: "Rechnung analysieren" }).click();
  const rulesEditor = page.getByRole("heading", { name: "Regeln" }).locator("../..");

  await rulesEditor.getByRole("button", { name: "Regel", exact: true }).click();
  await rulesEditor.getByLabel("Regelbegriff").fill(ruleName);
  await rulesEditor.getByRole("button", { name: "Ubernehmen" }).click();
  await rulesEditor.getByRole("button", { name: "Speichern" }).click();
  await expect(rulesEditor.getByText(ruleName, { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Rechnung analysieren" }).click();
  const persistedEditor = page.getByRole("heading", { name: "Regeln" }).locator("../..");
  const row = persistedEditor.locator("article").filter({ hasText: ruleName });
  await expect(row).toBeVisible();
  await row.getByTitle("Regel loschen").click();
  await persistedEditor.getByRole("button", { name: "Speichern" }).click();
  await expect(row).toHaveCount(0);
});

test("creates, completes, and deletes a rotating chore", async ({ page }, testInfo) => {
  const choreName = `Playwright Chore ${testInfo.project.name}`;

  await page.getByRole("button", { name: "Aufgaben" }).click();
  await page.getByRole("button", { name: "Aufgabe", exact: true }).click();
  await page.getByLabel("Titel").fill(choreName);
  await expect(page.getByLabel("Wochentag")).toHaveValue("wednesday");
  await page.getByLabel("Wochentag").selectOption({ label: "Freitag" });
  await page.getByRole("button", { name: "Speichern" }).click();

  const row = page.locator("article").filter({ hasText: choreName });
  await expect(row).toBeVisible();
  await expect(row.getByText("Freitag", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "Erledigt" }).click();
  await expect(row.getByText(secondRoommate.name)).toBeVisible();

  await row.getByTitle("Loschen").click();
  await expect(row).toHaveCount(0);
});

test("shows and advances the persisted Wäsche and Pfand rotations", async ({ page }) => {
  await page.getByRole("button", { name: "Aufgaben" }).click();

  const cards = page.getByTestId("rotation-card");
  await expect(cards).toHaveCount(2);
  const laundry = cards.filter({ hasText: "Wäsche" });
  await expect(cards.filter({ hasText: "Pfand" })).toBeVisible();

  const current = (await laundry.getByTestId("rotation-current").textContent()) ?? "";
  const next = roommateNames[(roommateNames.indexOf(current) + 1) % roommateNames.length];

  await laundry.getByRole("button", { name: "Wäsche erledigt" }).click();
  await expect(laundry.getByTestId("rotation-current")).toHaveText(next);
});

test("creates, edits, completes, and deletes a rotation", async ({ page }, testInfo) => {
  const rotationName = `Playwright Rad ${testInfo.project.name}`;
  const updatedName = `${rotationName} neu`;
  await page.getByRole("button", { name: "Aufgaben" }).click();
  await page.getByRole("button", { name: "Rad", exact: true }).click();
  await page.getByLabel("Name").fill(rotationName);
  await page.getByLabel("Notiz").fill("Testrotation");
  await page.getByRole("button", { name: "Speichern" }).click();

  let card = page.getByTestId("rotation-card").filter({ hasText: rotationName });
  await expect(card).toBeVisible();
  await card.getByTitle(`${rotationName} bearbeiten`).click();
  await page.getByLabel("Name").fill(updatedName);
  await page.getByRole("button", { name: "Speichern" }).click();

  card = page.getByTestId("rotation-card").filter({ hasText: updatedName });
  await expect(card).toBeVisible();
  const current = (await card.getByTestId("rotation-current").textContent()) ?? "";
  const next = roommateNames[(roommateNames.indexOf(current) + 1) % roommateNames.length];
  await card.getByRole("button", { name: `${updatedName} erledigt` }).click();
  await expect(card.getByTestId("rotation-current")).toHaveText(next);

  await card.getByTitle(`${updatedName} löschen`).click();
  await expect(card).toHaveCount(0);
});
