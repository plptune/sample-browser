// Retours n° 3 : plus de ▶ sur la ligne lue, dossiers repliables en recherche, ⌘→ replie tout (comme ⌘←).
import { expect, test, type Page } from "@playwright/test";

async function scenario(page: Page, key: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press(key);
  await expect(page.locator(".cr-node").first()).toBeVisible();
  return errors;
}

test("ligne lue : pas d'icône ▶ dans sa case", async ({ page }) => {
  const errors = await scenario(page, "6"); // Lecture : un sample sélectionné
  await page.keyboard.press("Escape");
  const wave = await page.locator(".cr-drawer__wave").boundingBox();
  await page.mouse.click(wave!.x + wave!.width * 0.6, wave!.y + wave!.height / 2);
  const playing = page.locator(".cr-node[data-playing]");
  await expect(playing).toHaveCount(1);
  await expect(playing.locator(".cr-node__slot svg")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("recherche : un dossier se referme et se rouvre (case, double clic, ← / →)", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("kick ");
  const folder = page.locator('.cr-node[aria-level="1"][aria-expanded]').first();
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  const name = (await folder.locator(".cr-node__label").textContent())!;
  const row = page.locator(".cr-node", { has: page.locator(".cr-node__label", { hasText: name }) }).first();
  const total = await page.locator(".cr-node").count();

  // Case du chevron.
  await row.locator(".cr-node__slot").dispatchEvent("mousedown");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.locator(".cr-node").count()).toBeLessThan(total);
  await row.locator(".cr-node__slot").dispatchEvent("mousedown");
  await expect(row).toHaveAttribute("aria-expanded", "true");

  // Double clic.
  await row.dblclick();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.dblclick();
  await expect(row).toHaveAttribute("aria-expanded", "true");

  // Clavier : ↓ va sur un sample, ← referme son dossier et le sélectionne, → le rouvre.
  await page.locator(".cr-tree").focus();
  await page.keyboard.press("ArrowDown");
  const sel = page.locator(".cr-node[data-selected]");
  await expect(sel).toHaveAttribute("data-kind", "sample");
  await page.keyboard.press("ArrowLeft");
  await expect(sel).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(sel).toHaveAttribute("aria-expanded", "true");

  // Une autre recherche rouvre tout.
  await row.dblclick();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("kick");
  await expect(page.locator('.cr-node[aria-expanded="false"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const shortcut of ["Control+ArrowRight", "Control+ArrowLeft"]) {
  test(`${shortcut === "Control+ArrowRight" ? "⌘→" : "⌘←"} replie tout, hors recherche et en recherche`, async ({ page }) => {
    const errors = await scenario(page, "3");
    await expect(page.locator('.cr-node[aria-expanded="true"]')).not.toHaveCount(0);
    await page.keyboard.press(shortcut);
    await expect(page.locator('.cr-node[aria-expanded="true"]')).toHaveCount(0);
    await expect(page.locator(".cr-node[data-selected]")).toHaveAttribute("aria-level", "1");

    await page.keyboard.press("Control+f");
    await page.keyboard.type("kick ");
    await expect(page.locator('.cr-node[aria-expanded="true"]')).not.toHaveCount(0);
    await page.locator(".cr-tree").focus();
    await page.keyboard.press(shortcut);
    await expect(page.locator('.cr-node[aria-expanded="true"]')).toHaveCount(0);
    await expect(page.locator(".cr-node:not([aria-level='1'])")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
