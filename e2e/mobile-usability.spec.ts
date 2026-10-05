import { expect, test, type Page } from "@playwright/test";

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const button = dialog.getByRole("button", { name: /^(Speichern|Zahlung buchen|Analysieren)$/ }).last();
    const box = await button.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
}
for (const width of [320, 390, 1280]) {
  test(`finance, task and forms remain usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Finanzen", exact: true })).toBeVisible();
    await fits(page);
    if (width < 640) expect((await page.getByRole("banner").boundingBox())!.height).toBeLessThanOrEqual(120);
    await page.screenshot({ path: info.outputPath(`finance-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Ausgabe", exact: true }).click();
    await page.getByRole("button", { name: "Individuell", exact: true }).click();
    await page.getByLabel("Beschreibung", { exact: true }).fill("Synthetischer Entwurf");
    await fits(page);
    await page.screenshot({ path: info.outputPath(`expense-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Ausgleich buchen", exact: true }).click();
    await fits(page);
    await page.screenshot({ path: info.outputPath(`settlement-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Aufgaben", exact: true }).click();
    await fits(page);
    await page.screenshot({ path: info.outputPath(`tasks-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Aufgabe", exact: true }).click();
    await page.getByLabel("Titel", { exact: true }).fill("Synthetischer Aufgabenentwurf");
    await fits(page);
    await page.screenshot({ path: info.outputPath(`chore-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Rad", exact: true }).click();
    await fits(page);
    await page.screenshot({ path: info.outputPath(`rotation-${width}.png`) });
    await page.keyboard.press("Escape");
  });
}
