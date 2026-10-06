import { expect, test, type Page } from "@playwright/test";
import { roommateIds } from "../src/shared/config";
import { calculateBalances, suggestSettlements } from "../src/shared/finance";
import { formatMoney } from "../src/shared/format";
import { receiptTrackingCategories, type FinanceTransaction } from "../src/shared/types";

// Reuse the suite's synthetic identity/SQLite server; isolate finance per browser
// so pagination never depends on records left by another test or invokes inference.
async function financeFixture(page: Page) {
  let transactions: FinanceTransaction[] = Array.from({ length: 21 }, (_, index) => {
    const amountCents = 1000 + index * 100;
    const settlement = index % 7 === 5;
    return {
      id: `pagination-${index}`, type: settlement ? "settlement" : "expense",
      description: `${settlement ? "Ausgleich" : index % 2 ? "Haushaltsausgabe" : "Marktrechnung"} ${String(index + 1).padStart(2, "0")}`,
      amountCents, paidAt: `2026-09-${String(30 - index).padStart(2, "0")}`,
      createdBy: roommateIds[0], createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z",
      paidBy: settlement ? undefined : roommateIds[0],
      fromRoommateId: settlement ? roommateIds[1] : undefined,
      toRoommateId: settlement ? roommateIds[0] : undefined,
      splits: settlement ? [] : [{ roommateId: roommateIds[1], owedCents: amountCents }],
      receiptItems: !settlement && index % 2 === 0 ? [{
        name: `Testprodukt ${index}`, normalizedName: `Testprodukt ${index}`,
        category: receiptTrackingCategories[(Math.floor(index / 2) - (index > 12 ? 1 : 0)) % 8], quantity: "1",
        amountCents, assignmentReason: "Synthetischer Einkauf",
        splits: [{ roommateId: roommateIds[1], amountCents }],
      }] : [],
    };
  });
  const mutations: { method: string; id: string }[] = [];
  let expired = false;
  await page.route("**/api/finance", async (route) => {
    const balances = calculateBalances(transactions, roommateIds);
    await route.fulfill({ json: { transactions, balances, suggestedSettlements: suggestSettlements(balances) } });
  });
  await page.route("**/api/finance/expenses{,/**}", async (route) => {
    const method = route.request().method();
    const id = new URL(route.request().url()).pathname.split("/")[4] ?? "new-booking";
    mutations.push({ method, id });
    if (expired) {
      await route.fulfill({ status: 401, json: { error: "Authentication required", code: "authentication_required" } });
      return;
    }
    if (method === "DELETE") transactions = transactions.filter((transaction) => transaction.id !== id);
    else {
      const body = route.request().postDataJSON();
      if (method === "PATCH") transactions = transactions.map((transaction) => transaction.id === id ? { ...transaction, description: body.description } : transaction);
      else transactions = [{ ...transactions[0], id, description: body.description, amountCents: body.amountCents, receiptItems: [], splits: [{ roommateId: roommateIds[1], owedCents: body.amountCents }] }, ...transactions];
    }
    await route.fulfill({ json: { ok: true } });
  });
  return {
    get transactions() { return transactions; }, mutations,
    shrink: (count: number) => { transactions = transactions.slice(0, count); },
    expire: () => { expired = true; },
  };
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("mixed bookings paginate in order, preserve aggregates, edit/delete by ID and reset after creation", async ({ page }) => {
  const fixture = await financeFixture(page);
  await page.goto("/");
  const ledger = page.getByRole("region", { name: "Buchungen", exact: true });
  const nav = page.getByRole("navigation", { name: "Buchungsseiten" });
  const rows = ledger.locator("article");
  const tracking = page.getByRole("region", { name: "Warengruppen", exact: true });
  const total = fixture.transactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amountCents, 0);
  await expect(page.getByTestId("total-spent")).toContainText(formatMoney(total));
  const balances = await page.getByTestId("balance-card").allTextContents();
  await expect(page.getByTestId("balance-card").first()).toContainText(formatMoney(calculateBalances(fixture.transactions, roommateIds)[0].balanceCents));
  const trackingText = await tracking.textContent();
  await expect(tracking).toContainText("10 Positionen");
  await expect(rows).toHaveCount(10);
  await expect(rows.locator("h4")).toHaveText(fixture.transactions.slice(0, 10).map((t) => t.description));
  await expect(nav.getByRole("status")).toHaveText("1–10 von 21 Buchungen");
  await expect(nav.getByRole("button", { name: "Zurück" })).toBeDisabled();
  await nav.getByRole("button", { name: "Weiter" }).click();
  await expect(rows.locator("h4")).toHaveText(fixture.transactions.slice(10, 20).map((t) => t.description));
  await expect(nav.getByRole("status")).toHaveText("11–20 von 21 Buchungen");
  await expect(page.getByTestId("total-spent")).toContainText(formatMoney(total));
  expect(await page.getByTestId("balance-card").allTextContents()).toEqual(balances);
  expect(await tracking.textContent()).toBe(trackingText);
  await nav.getByRole("button", { name: "Zurück" }).click();
  await expect(nav.getByLabel("Buchungsseite")).toHaveValue("1");
  await nav.getByLabel("Buchungsseite").fill("99");
  await expect(nav.getByLabel("Buchungsseite")).toHaveValue("3");
  await expect(rows).toHaveCount(1);
  await expect(nav.getByRole("button", { name: "Weiter" })).toBeDisabled();
  await rows.getByTitle("Bearbeiten", { exact: true }).click();
  await page.getByLabel("Beschreibung", { exact: true }).fill("Späte Rechnung bearbeitet");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(rows.locator("h4")).toHaveText(["Späte Rechnung bearbeitet"]);
  expect(fixture.mutations.at(-1)).toEqual({ method: "PATCH", id: "pagination-20" });
  await rows.getByTitle("Loschen", { exact: true }).click();
  await expect(nav.getByRole("status")).toHaveText("11–20 von 20 Buchungen");
  await expect(nav.getByLabel("Buchungsseite")).toHaveValue("2");
  expect(fixture.mutations.at(-1)).toEqual({ method: "DELETE", id: "pagination-20" });
  await expect(page.getByTestId("total-spent")).toContainText(formatMoney(total - 3000));
  await expect(tracking).toContainText("9 Positionen");
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await page.getByLabel("Beschreibung", { exact: true }).fill("Neue Buchung");
  await page.getByLabel("Betrag", { exact: true }).fill("9,00");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(nav.getByRole("status")).toHaveText("1–10 von 21 Buchungen");
  await expect(rows.first()).toContainText("Neue Buchung");
  await nav.getByLabel("Buchungsseite").fill("0");
  await expect(nav.getByLabel("Buchungsseite")).toHaveValue("1");
});

test("data shrink clamps the page and empty data has no invalid range", async ({ page }) => {
  const fixture = await financeFixture(page);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Buchungsseiten" });
  await nav.getByLabel("Buchungsseite").fill("3");
  fixture.shrink(10);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav.getByRole("status")).toHaveText("1–10 von 10 Buchungen");
  await expect(nav.getByRole("button", { name: "Weiter" })).toBeDisabled();
  fixture.shrink(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Noch keine Buchungen.", { exact: true })).toBeVisible();
  await expect(nav).toHaveCount(0);
  await expect(page.getByTestId("total-spent")).toContainText(formatMoney(0));
  await expect(page.getByText("Noch keine Produktdaten.", { exact: true })).toBeVisible();
});

test("finance hierarchy, expandable categories and draft-safe expiry fit the viewport", async ({ page }, info) => {
  const fixture = await financeFixture(page);
  await page.goto("/");
  const tracking = page.getByRole("region", { name: "Warengruppen", exact: true });
  const categories = tracking.locator("#tracking-categories > div");
  await expect(categories).toHaveCount(5);
  await expect(tracking).toContainText("10 Positionen");
  const toggle = tracking.getByRole("button", { name: "Alle 8 Warengruppen anzeigen" });
  await toggle.click();
  await expect(categories).toHaveCount(8);
  await expect(tracking.getByRole("button", { name: "Weniger Warengruppen" })).toHaveAttribute("aria-expanded", "true");
  await tracking.getByRole("button", { name: "Weniger Warengruppen" }).click();
  await fits(page);
  await page.screenshot({ path: info.outputPath("finance.png"), fullPage: true });
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 720 });
    await fits(page);
    await page.screenshot({ path: info.outputPath("finance-320.png"), fullPage: true });
  } else {
    const ledger = await page.getByRole("region", { name: "Buchungen", exact: true }).boundingBox();
    const sidebar = await tracking.boundingBox();
    expect(ledger!.width).toBeGreaterThan(sidebar!.width * 2);
    for (const width of [1024, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await fits(page);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
  await page.getByLabel("Beschreibung", { exact: true }).fill("Entwurf bleibt erhalten");
  await page.getByLabel("Betrag", { exact: true }).fill("12,00");
  fixture.expire();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Anmeldung bestätigt");
  await expect(page.getByLabel("Beschreibung", { exact: true })).toHaveValue("Entwurf bleibt erhalten");
  await fits(page);
  await page.screenshot({ path: info.outputPath("expired-draft.png") });
  await expect(page.getByRole("dialog").getByRole("link", { name: "Erneut anmelden" })).toHaveCount(0);
  await expect(page.getByLabel("Beschreibung", { exact: true })).toHaveValue("Entwurf bleibt erhalten");
  expect(fixture.mutations).toHaveLength(1);
  await page.route("**/api/session", route => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Anmeldung erforderlich");
  await page.keyboard.press("Escape");
  const notice = page.locator(".global-auth-alert");
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Erneut anmelden" })).toHaveAttribute("target", "_blank");
  await fits(page);
  await page.screenshot({ path: info.outputPath("expired-finance.png"), fullPage: true });
});
