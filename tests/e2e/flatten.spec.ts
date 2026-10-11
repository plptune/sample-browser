// Bande sous le champ, en recherche : Flatten (résultats à plat, en couleur primaire) et Shuffle (ordre aléatoire).
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

/** Les noms des samples à l'écran, dans l'ordre. */
const labels = (page: Page) => page.locator('.cr-node[data-kind="sample"] .cr-node__label').allTextContents();

test("Flatten : seulement en recherche, en couleur primaire quand il est actif", async ({ page }) => {
  const errors = await scenario(page, "3");
  await expect(page.locator(".cr-search__options")).toHaveCount(0);
  await page.keyboard.press("Control+f");
  await page.keyboard.type("kick");
  const flatten = page.getByRole("button", { name: "Flatten" });
  await expect(flatten).toBeVisible();
  await expect(page.getByRole("button", { name: "Shuffle results" })).toHaveCount(0);
  const accent = await page.evaluate(() => getComputedStyle(document.querySelector(".cr-root")!).getPropertyValue("--cr-accent").trim());
  const idle = await flatten.evaluate((el) => getComputedStyle(el).color);
  await flatten.click();
  await expect(flatten).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.cr-node[data-kind="folder"]')).toHaveCount(0);
  const on = await flatten.evaluate((el) => getComputedStyle(el).color);
  expect(on).not.toBe(idle);
  // La couleur primaire (accent) : même teinte que le token.
  const probe = await page.evaluate((c) => {
    const d = document.createElement("div");
    d.style.color = c;
    document.body.append(d);
    const v = getComputedStyle(d).color;
    d.remove();
    return v;
  }, accent);
  expect(on).toBe(probe);
  expect(errors).toEqual([]);
});

test("Shuffle : chaque clic, un autre ordre des mêmes samples ; une autre recherche revient à l'ordre normal", async ({ page }) => {
  await scenario(page, "3");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("kick");
  await page.getByRole("button", { name: "Flatten" }).click();
  await expect(page.locator('.cr-node[data-kind="folder"]')).toHaveCount(0);
  const plain = await labels(page);
  expect(plain.length).toBeGreaterThan(5);
  const total = Number(await page.locator(".cr-tree").getAttribute("aria-rowcount"));

  const shuffle = page.getByRole("button", { name: "Shuffle results" });
  await shuffle.click();
  await expect.poll(() => labels(page)).not.toEqual(plain);
  const first = await labels(page);
  await shuffle.click();
  await expect.poll(() => labels(page)).not.toEqual(first);
  // Mêmes résultats (la liste est virtualisée : on compare leur nombre, pas les lignes à l'écran).
  await expect(page.locator(".cr-tree")).toHaveAttribute("aria-rowcount", String(total));

  // Recherche modifiée puis remise : l'ordre normal revient.
  await page.locator(".cr-search__input").focus();
  await page.keyboard.type("_");
  await page.keyboard.press("Backspace");
  await expect.poll(() => labels(page)).toEqual(plain);

  // Couper Flatten masque Shuffle ; le rallumer garde l'ordre normal.
  await page.getByRole("button", { name: "Flatten" }).click();
  await expect(shuffle).toHaveCount(0);
  await page.getByRole("button", { name: "Flatten" }).click();
  await expect.poll(() => labels(page)).toEqual(plain);
});

test("Flatten reste actif d'une recherche à l'autre", async ({ page }) => {
  await scenario(page, "3");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("kick");
  await page.getByRole("button", { name: "Flatten" }).click();
  await page.keyboard.press("Escape"); // efface la recherche
  await page.locator(".cr-search__input").focus();
  await page.keyboard.type("snare");
  await expect(page.getByRole("button", { name: "Flatten" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.cr-node[data-kind="folder"]')).toHaveCount(0);
});
