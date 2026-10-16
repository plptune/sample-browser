// Retours n° 4 : le menu du clic droit reste ouvert au relâchement, Espace peut piloter Bitwig, tags sur une ligne.
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

test("clic droit en bas de la colonne : le menu reste ouvert au relâchement", async ({ page }) => {
  const errors = await scenario(page, "3"); // Samples › Drums › Kicks ouverts
  const menu = page.locator(".cr-menu");
  const treeBottom = (await page.locator(".cr-tree").boundingBox())!;
  const rows = page.locator('.cr-node[data-kind="sample"]');
  // Une ligne visible du bas : le menu, recalé vers le haut, s'ouvre avec un item sous le pointeur (le cas du retour).
  let at: { x: number; y: number } | null = null;
  for (let i = (await rows.count()) - 1; i >= 0 && !at; i--) {
    const b = await rows.nth(i).boundingBox();
    if (!b || b.y + b.height > treeBottom.y + treeBottom.height) continue;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await expect(menu).toBeVisible();
    const over = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest(".cr-menu__item"), [x, y]);
    if (over) at = { x, y };
    else {
      await page.keyboard.press("Escape");
      await page.mouse.up({ button: "right" });
    }
  }
  expect(at).not.toBeNull();
  await page.mouse.up({ button: "right" });
  await expect(menu).toBeVisible();

  // Un vrai clic sur un item l'exécute.
  await page.getByRole("menuitem", { name: "Add to favorites" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.cr-node[data-selected] .cr-node__fav')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("clic droit maintenu, glissé jusqu'à un item puis relâché : l'item est choisi", async ({ page }) => {
  const errors = await scenario(page, "3");
  const row = page.locator('.cr-node[data-kind="sample"]').first();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  const fav = page.getByRole("menuitem", { name: "Add to favorites" });
  const p = (await fav.boundingBox())!;
  await page.mouse.move(p.x + 20, p.y + p.height / 2, { steps: 4 });
  await page.mouse.up({ button: "right" });
  await expect(page.locator(".cr-menu")).toHaveCount(0);
  await expect(row.locator(".cr-node__fav")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Espace : lecture / arrêt de la preview par défaut ; avec « Space plays Bitwig », l'arrête sans la relancer", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.locator('.cr-node[data-kind="sample"]').first().click(); // lecture auto : le clic lit
  const playing = page.locator(".cr-node[data-playing]");
  await expect(playing).toHaveCount(1);
  await page.keyboard.press(" ");
  await expect(playing).toHaveCount(0);

  await page.keyboard.press("Control+,");
  await page.getByRole("radio", { name: "Playback", exact: true }).click();
  await page.getByRole("switch", { name: "Space plays Bitwig" }).click();
  await page.keyboard.press("Escape");
  await page.locator('.cr-node[data-kind="sample"]').nth(1).click();
  await expect(playing).toHaveCount(1);
  await page.keyboard.press(" "); // la preview s'arrête
  await expect(playing).toHaveCount(0);
  await page.keyboard.press(" "); // et ne repart pas
  await page.waitForTimeout(200);
  await expect(playing).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Réglages : « Space plays Bitwig » montre l'état de Bitwig et installe le script", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.keyboard.press("Control+,");
  await page.getByRole("radio", { name: "Playback", exact: true }).click();
  const install = page.getByRole("button", { name: "Install Bitwig script" });
  await expect(install).toHaveCount(0); // réglage coupé : rien à installer
  await page.getByRole("switch", { name: "Space plays Bitwig" }).click();
  await expect(page.getByText(/^Waiting for Bitwig/)).toBeVisible();
  // Plus d'autorisation Accessibilité pour ce réglage.
  await expect(page.getByRole("button", { name: "Open settings" })).toHaveCount(0);
  await install.click();
  await expect(page.getByText(/^Installed in .*Controller Scripts\/Crate\/Crate\.control\.js$/)).toBeVisible();
  await expect(page.getByText("Bitwig connected")).toBeVisible(); // Bitwig factice : répond une fois le script copié
  expect(errors).toEqual([]);
});

test("colonne : les tags du tiroir tiennent sur une ligne, les derniers sont masqués", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.locator('.cr-node[data-kind="sample"]').first().click();
  const input = page.getByLabel("Add a tag");
  for (const t of ["atmospheric", "distorted", "punchy", "vintage", "processed", "saturated", "industrial", "cinematic"]) {
    await input.fill(t);
    await input.press("Enter");
  }
  const tags = page.locator(".cr-drawer__tags");
  const chip = (await page.locator(".cr-drawer .cr-tag").first().boundingBox())!;
  const line = (await tags.boundingBox())!;
  expect(line.height).toBeLessThanOrEqual(chip.height + 4);
  // Les tags qui ne tiennent pas sont passés sur la ligne masquée ; aucun n'est coupé en largeur.
  const hidden = await page.evaluate(() => {
    const box = document.querySelector(".cr-drawer .cr-drawer__chips")!.getBoundingClientRect();
    return [...document.querySelectorAll(".cr-drawer .cr-tag")].filter((t) => t.getBoundingClientRect().top >= box.bottom).length;
  });
  expect(hidden).toBeGreaterThan(0);
  await expect(page.getByLabel("Add a tag")).toBeVisible();
  expect(errors).toEqual([]);
});
