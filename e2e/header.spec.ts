import { expect, test } from "@playwright/test";

test("shows one header brand and preserves finance and task headings", async ({ page }, testInfo) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(page.getByRole("heading", { name: "Finanzen", exact: true })).toBeVisible();
  await expect(header.getByRole("heading", { level: 1 })).toHaveText("Hugo Wolfgang");

  // Capture the rendered page before the regression assertion, including on failure.
  const screenshot = testInfo.outputPath("header.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("Rendered header", { path: screenshot, contentType: "image/png" });

  const brands = header.getByText(/^Hugo(?: Wolfgang|-Wolf-Gang)$/).filter({ visible: true });
  await expect.soft(brands).toHaveCount(1);
  await expect(header.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(header.getByRole("button", { name: "Finanzen", exact: true })).toBeVisible();
  await header.getByRole("button", { name: "Aufgaben", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aufgaben", exact: true })).toBeVisible();
  await expect.soft(brands).toHaveCount(1);
  await header.getByRole("button", { name: "Finanzen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finanzen", exact: true })).toBeVisible();
});
