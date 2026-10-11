// Filtres rapides de l'entonnoir : favoris, collections, boucles / one-shots, mineur / majeur. Chaque filtre pose
// une chip de recherche (décocher la retire) ; le menu reste ouvert pour en cocher plusieurs.
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

const item = (page: Page, name: string) => page.getByRole("menuitemcheckbox", { name, exact: true });

test("Favorites : chip is:fav, seulement des favoris, menu ouvert, entonnoir en accent ; décocher la retire", async ({ page }) => {
  const errors = await scenario(page, "3");
  const filters = page.getByRole("button", { name: /^Filters/ });
  await filters.click();
  await item(page, "Favorites").click();
  await expect(item(page, "Favorites")).toHaveAttribute("aria-checked", "true"); // menu toujours ouvert
  await expect(page.locator(".cr-search__chips")).toContainText("fav");
  await expect(filters).toHaveAttribute("data-primary", "true");
  await expect(filters).toHaveAttribute("aria-label", "Filters (1 active)");
  // Les samples affichés sont des favoris : chacun montre « Remove from favorites » dans le tiroir.
  await page.keyboard.press("Escape");
  const rows = page.locator('.cr-node[data-kind="sample"]');
  const n = Math.min(await rows.count(), 4);
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click();
    await expect(page.getByRole("button", { name: "Remove from favorites (⌘D)" })).toBeVisible();
  }
  await filters.click();
  await item(page, "Favorites").click();
  await expect(item(page, "Favorites")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".cr-search__chips")).not.toContainText("fav");
  expect(errors).toEqual([]);
});

test("Loops / One-shots et Minor / Major s'excluent", async ({ page }) => {
  await scenario(page, "3");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await item(page, "Loops").click();
  await item(page, "One-shots").click();
  await expect(item(page, "Loops")).toHaveAttribute("aria-checked", "false");
  await expect(item(page, "One-shots")).toHaveAttribute("aria-checked", "true");
  await item(page, "Minor").click();
  await item(page, "Major").click();
  await expect(item(page, "Minor")).toHaveAttribute("aria-checked", "false");
  await expect(item(page, "Major")).toHaveAttribute("aria-checked", "true");
  const text = await page.locator(".cr-search__chips").innerText();
  expect(text).toContain("oneshot");
  expect(text).not.toContain("loop");
  expect(text).toContain("major");
  expect(text).not.toContain("minor");
});

test("une collection de la liste : chip in:\"…\", ses samples seulement ; In a collection", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await item(page, "Vocal chops").click();
  await expect(page.locator(".cr-search__chips")).toContainText("Vocal chops");
  await page.keyboard.press("Escape");
  const names = await page.locator('.cr-node[data-kind="sample"] .cr-node__label').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((n) => n.startsWith("Vox_Chop"))).toBe(true);
  // « In a collection » : au moins une collection manuelle.
  await page.getByRole("button", { name: /^Filters/ }).click();
  await item(page, "Vocal chops").click();
  await item(page, "In a collection").click();
  await expect(page.locator(".cr-search__chips")).toContainText("collection");
  await expect(page.locator('.cr-node[data-kind="sample"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("taper key:minor fonctionne aussi (proposé par l'autocomplétion)", async ({ page }) => {
  await scenario(page, "3");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("key:mi");
  await expect(page.locator(".cr-ac").getByText("key:minor", { exact: true })).toBeVisible();
});
