import { expect, test } from "@playwright/test";
// Live saved tracker data is read-only; all Flat state uses the isolated E2E DB.
test("native TGTG navigation, photos, search, stable/rated filters and history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "TGTG", exact: true }).click();
  await expect(page).toHaveURL(/\/tgtg$/);
  await expect(page.getByRole("heading", { name: "Sackerl finden" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Sackerl suchen" }).fill("MEET Heinrich");
  await expect(page.locator(".tg-card")).toHaveCount(1);
  await page.getByLabel("Unveränderter Preis", { exact: true }).check();
  await page.getByLabel("★ 4,5+ · 30+ Bewertungen", { exact: true }).check();
  const card = page.locator(".tg-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("4,99");
  await expect(card).toContainText("4.57");
  await expect(card.locator(".tg-cover img")).toBeVisible();
  await expect.poll(() => card.locator(".tg-cover img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const bounds = await card.evaluate(el => ({ cover: el.querySelector(".tg-cover")!.getBoundingClientRect().bottom, image: el.querySelector(".tg-cover img")!.getBoundingClientRect().bottom, merchant: el.querySelector(".tg-store")!.getBoundingClientRect().top }));
  expect(bounds.image).toBeLessThanOrEqual(bounds.cover + 1);
  expect(bounds.merchant).toBeGreaterThanOrEqual(bounds.cover);
  await card.getByRole("button", { name: "Verlauf & Feedback" }).click();
  await expect(page.locator("dialog tbody tr").first()).toBeVisible();
  await page.getByLabel("Verlauf schließen").click();
  await page.getByLabel("Unveränderter Preis", { exact: true }).uncheck();
  await page.getByLabel("★ 4,5+ · 30+ Bewertungen", { exact: true }).uncheck();
  await page.getByRole("searchbox").fill("");
  await page.getByLabel("Umkreis").selectOption("999");
  await page.getByRole("button", { name: /^Favoriten/ }).click();
  const appCount = await page.locator(".tg-card").count();
  expect(appCount).toBeGreaterThan(0);
  await expect(page.locator(".tg-card .tg-heart")).toHaveCount(appCount);
  await page.getByLabel("Favoritenquelle").selectOption("local");
  await expect(page.locator(".tg-card").first()).toContainText("Tracker-Präferenz");
  await page.getByRole("button", { name: "Alle Sackerl", exact: true }).click();
  await page.getByRole("searchbox").fill("202123");
  await expect(page.locator(".tg-card")).toContainText("Nicht wieder kaufen");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test("other WG roommate sees general knowledge without owner favourites or notes", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "X-Flat-Email": "ui-stadlmann@example.test", "X-Flat-Uid": "ui-stadlmann" });
  await page.goto("/tgtg");
  await expect(page.locator(".tg-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Favoriten/ })).toHaveCount(0);
  const data = await (await page.request.get("/api/tgtg/catalog?personal=true")).json();
  expect(data.personal).toBe(false);
  expect(data.coverage.app_favorites).toBeUndefined();
  for (const bag of data.items) {
    expect(bag.app_favorite).toBeUndefined(); expect(bag.local_favorite).toBeUndefined(); expect(bag.reviews).toBeUndefined();
  }
  await page.getByRole("searchbox").fill("MEET Heinrich");
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.locator("dialog tbody tr").first()).toBeVisible();
});
