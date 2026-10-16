// Liste d'Expanded : colonne Type (triable), colonnes au choix (clic droit sur l'en-tête), ordre par glisser d'un
// en-tête ; un dossier virtuel cliqué ne filtre pas la liste (ni chip, ni barre de portée).
import { expect, test, type Page } from "@playwright/test";

async function full(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("3");
  await expect(page.locator(".cr-node[data-selected]")).toHaveCount(1);
  await page.getByRole("button", { name: "Expanded (⌘⇧F)" }).click();
  await expect(page.locator(".cr-panel[data-layout=full]")).toBeVisible();
  // Toute la bibliothèque (pas seulement le dossier du sample).
  await page.locator(".cr-tree[data-root=library]").focus();
  await page.keyboard.press("Escape");
  return errors;
}

const headers = (page: Page) => page.locator(".cr-table__head [role=columnheader] .cr-table__label").allTextContents();
const header = (page: Page, label: string) => page.getByRole("columnheader", { name: new RegExp(`^${label}`) });

test("colonne Type : un badge par ligne ; trier par type met les boucles d'abord, puis les one-shots", async ({ page }) => {
  const errors = await full(page);
  expect(await headers(page)).toEqual(["Name", "Type", "BPM", "Key", "Length", "Format", "Tags"]);
  await header(page, "Type").click();
  await expect(header(page, "Type")).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator(".cr-table__row .cr-col-kind .cr-kind").first()).toHaveAttribute("data-kind", "loop");
  await header(page, "Type").click();
  await expect(header(page, "Type")).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator(".cr-table__row .cr-col-kind .cr-kind").first()).toHaveAttribute("data-kind", "oneshot");
  expect(errors).toEqual([]);
});

test("clic droit sur l'en-tête : cocher / décocher les colonnes ; Name toujours là ; Reset", async ({ page }) => {
  await full(page);
  await header(page, "BPM").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Name" })).toHaveAttribute("aria-disabled", "true");
  await menu.getByRole("menuitemcheckbox", { name: "Format" }).click();
  // Le menu reste ouvert : on en décoche une autre d'affilée.
  await menu.getByRole("menuitemcheckbox", { name: "Length" }).click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Format" })).toHaveAttribute("aria-checked", "false");
  await menu.getByRole("menuitemcheckbox", { name: "Name" }).click({ force: true }); // grisée : sans effet
  await page.keyboard.press("Escape");
  expect(await headers(page)).toEqual(["Name", "Type", "BPM", "Key", "Tags"]);
  await expect(page.locator(".cr-table__row .cr-col-fmt")).toHaveCount(0);

  // (Gardées dans les réglages de la vraie bibliothèque ; la démo, elle, repart toujours des mêmes réglages.)
  await header(page, "Name").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reset columns" }).click();
  expect(await headers(page)).toEqual(["Name", "Type", "BPM", "Key", "Length", "Format", "Tags"]);
});

test("tirer l'en-tête BPM après Key : l'ordre change dans l'en-tête et dans les lignes ; un clic trie toujours", async ({ page }) => {
  await full(page);
  const bpm = (await header(page, "BPM").boundingBox())!;
  const key = (await header(page, "Key").boundingBox())!;
  await page.mouse.move(bpm.x + bpm.width / 2, bpm.y + bpm.height / 2);
  await page.mouse.down();
  await page.mouse.move(key.x + key.width - 2, key.y + key.height / 2, { steps: 8 });
  await expect(header(page, "BPM")).toHaveAttribute("data-dragging", "true");
  await page.mouse.up();
  expect(await headers(page)).toEqual(["Name", "Type", "Key", "BPM", "Length", "Format", "Tags"]);
  const cells = await page.locator(".cr-table__row").first().locator("[role=gridcell]").evaluateAll((els) => els.map((e) => e.className.split(" ")[0]));
  expect(cells).toEqual(["cr-col-name", "cr-col-kind", "cr-col-key", "cr-col-bpm", "cr-col-dur", "cr-col-fmt", "cr-col-tags"]);
  // L'en-tête n'a pas été pris pour un clic ; un vrai clic trie.
  await expect(header(page, "BPM")).toHaveAttribute("aria-sort", "none");
  await header(page, "BPM").click();
  await expect(header(page, "BPM")).toHaveAttribute("aria-sort", "ascending");
});

test("clic sur un dossier virtuel : aucune chip", async ({ page }) => {
  await full(page);
  await expect(page.locator(".cr-scopebar")).toHaveCount(0);
  const vf = page.locator(".cr-tree[data-root=virtual] .cr-node[data-kind=virtual]").first();
  await vf.click();
  await expect(vf).toHaveAttribute("data-selected", "true");
  await expect(page.locator(".cr-search__chips .cr-chip")).toHaveCount(0);
  await expect(page.locator(".cr-explorer .cr-node[data-scoped]")).toHaveCount(0);
});
