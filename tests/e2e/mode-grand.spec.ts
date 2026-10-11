// Fenêtre bibliothèque (mode grand) : explorer de dossiers à gauche, preview, recherche et liste triable à droite ;
// la sélection de l'explorer est la portée de la liste. On n'y entre et n'en sort que par le bouton ou ⌘⇧F.
import { expect, test, type Page } from "@playwright/test";

async function full(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("3"); // Navigation : Drums › Kicks ouverts, un kick sélectionné
  await expect(page.locator(".cr-node[data-selected]")).toHaveCount(1);
  await page.getByRole("button", { name: "Expanded (⌘⇧F)" }).click();
  await expect(page.locator(".cr-panel[data-layout=full]")).toBeVisible();
  return errors;
}

const scopeBar = (page: Page) => page.locator(".cr-scopebar");
const rowCount = async (page: Page) => Number(await page.getByRole("grid", { name: "Samples" }).getAttribute("aria-rowcount"));

test("explorer de dossiers seuls ; la portée part du dossier du sample, qui reste sélectionné", async ({ page }) => {
  const errors = await full(page);
  const explorer = page.locator(".cr-explorer");
  await expect(explorer.locator('.cr-node[data-kind="sample"]')).toHaveCount(0);
  // Une feuille (Kicks) n'a pas de chevron.
  const kicks = explorer.locator(".cr-node", { hasText: /^Kicks$/ });
  await expect(kicks).not.toHaveAttribute("aria-expanded", /.*/);
  await expect(kicks).toHaveAttribute("data-selected", "true");
  await expect(scopeBar(page).locator(".cr-scopebar__name")).toHaveText("Kicks");
  const selected = page.locator(".cr-table__row[data-selected]");
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".cr-node__label")).toHaveText(/^Kick_/);
  await expect(page.locator(".cr-preview__title")).toHaveText((await selected.locator(".cr-node__label").textContent())!);
  expect(errors).toEqual([]);
});

test("cliquer un dossier : toute sa sous-arborescence ; recherche dans la portée ; Échap revient à tout", async ({ page }) => {
  await full(page);
  await page.locator(".cr-explorer .cr-node", { hasText: /^Drums$/ }).click();
  await expect(scopeBar(page).locator(".cr-scopebar__name")).toHaveText("Drums");
  const drums = await rowCount(page);
  await expect(scopeBar(page)).toContainText(`${drums} samples`);
  expect(drums).toBeGreaterThan(34); // plus que Kicks seul : les sous-dossiers comptent

  await page.keyboard.press("Control+f");
  await page.keyboard.type("loop");
  await expect.poll(() => rowCount(page)).toBeLessThan(drums);
  const inDrums = await rowCount(page);
  expect(inDrums).toBeGreaterThan(0);

  // Échap dans l'explorer : plus de portée, la même recherche dans toute la bibliothèque.
  await page.locator(".cr-explorer .cr-tree").focus();
  await page.keyboard.press("Escape");
  await expect(scopeBar(page).locator(".cr-scopebar__name")).toHaveText("All samples");
  await expect.poll(() => rowCount(page)).toBeGreaterThan(inDrums);
});

test("tri par en-tête : BPM croissant puis décroissant, les sans-BPM toujours à la fin", async ({ page }) => {
  await full(page);
  await page.locator(".cr-explorer .cr-node", { hasText: /^Samples$/ }).click();
  const bpm = page.getByRole("columnheader", { name: /BPM/ });
  await bpm.click();
  await expect(bpm).toHaveAttribute("aria-sort", "ascending");
  const values = async () =>
    (await page.locator(".cr-table__row .cr-col-bpm").allTextContents()).map((t) => (t.trim() ? Number(t) : null));
  let v = await values();
  let nums = v.filter((x): x is number => x !== null);
  expect(nums.length).toBeGreaterThan(3);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  expect(v.indexOf(null) === -1 || v.slice(v.indexOf(null)).every((x) => x === null)).toBe(true);

  await bpm.click();
  await expect(bpm).toHaveAttribute("aria-sort", "descending");
  v = await values();
  nums = v.filter((x): x is number => x !== null);
  expect(nums).toEqual([...nums].sort((a, b) => b - a));
  await expect(page.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none");
});

test("clavier : Tab entre explorer et liste ; ↑ / ↓ dans l'explorer changent la portée", async ({ page }) => {
  await full(page);
  await page.locator(".cr-table__body").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".cr-explorer .cr-tree")).toBeFocused();
  await page.keyboard.press("ArrowUp"); // Kicks → Drums
  await expect(scopeBar(page).locator(".cr-scopebar__name")).toHaveText("Drums");
  await page.keyboard.press("Tab");
  await expect(page.locator(".cr-table__body")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cr-table__row[data-selected]")).toHaveCount(1);
});

test("preview : ajouter un tag au sample courant ; il apparaît dans la liste", async ({ page }) => {
  await full(page);
  await page.locator(".cr-preview").getByLabel("Add a tag").fill("crispy");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cr-preview .cr-tag", { hasText: /^crispy$/ })).toBeVisible();
  await expect(page.locator(".cr-table__row[data-selected] .cr-col-tags")).toContainText("crispy");
});

test("⌘⇧F aller-retour : même sample sélectionné ; le bouton de mode change avec le mode", async ({ page }) => {
  await full(page);
  const name = await page.locator(".cr-table__row[data-selected] .cr-node__label").textContent();
  await expect(page.getByRole("radiogroup", { name: "Display mode" })).toBeVisible();
  await page.getByRole("radio", { name: "Side panel (⌘⇧F)" }).click();
  await expect(page.locator(".cr-panel[data-layout=side]")).toBeVisible();
  await expect(page.locator(".cr-node[data-selected] .cr-node__label")).toHaveText(name!);
  await expect(page.getByRole("button", { name: "Expanded (⌘⇧F)" })).toBeVisible();
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator(".cr-table__row[data-selected] .cr-node__label")).toHaveText(name!);
});

test("glisser une ligne de la liste sur un dossier virtuel de l'explorer l'y range", async ({ page }) => {
  await full(page);
  const name = (await page.locator(".cr-table__row[data-selected] .cr-node__label").textContent())!;
  await page.keyboard.press("Control+2"); // explorer : favoris, collections, dossiers virtuels
  const target = page.locator(".cr-explorer .cr-node[data-kind=virtual]").first();
  await page.locator(".cr-table__row[data-selected]").dragTo(target);
  await target.click();
  await expect(page.locator(".cr-table__row .cr-node__label", { hasText: name })).toHaveCount(1);
});

test("⌘S avec une portée : la collection smart retrouve la même liste", async ({ page }) => {
  await full(page);
  await page.locator(".cr-explorer .cr-node", { hasText: /^Drums$/ }).click();
  await page.keyboard.press("Control+f");
  await page.keyboard.type("loop");
  await expect.poll(() => rowCount(page)).toBeGreaterThan(0);
  const n = await rowCount(page);
  await page.keyboard.press("Control+s");
  await page.locator(".cr-save__input").fill("Drum loops");
  await page.keyboard.press("Enter");
  await expect(scopeBar(page).locator(".cr-scopebar__name")).toHaveText("Drum loops");
  await expect(page.locator(".cr-search__chips .cr-chip")).toHaveCount(0);
  await expect.poll(() => rowCount(page)).toBe(n);
});

test("séparateur : tirer élargit l'explorer et rétrécit la liste ; double-clic : la largeur par défaut", async ({ page }) => {
  await full(page);
  const explorer = page.locator(".cr-explorer");
  const before = (await explorer.boundingBox())!.width;
  const s = (await page.getByRole("separator", { name: "Resize folders" }).boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + 200);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 150, s.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await explorer.boundingBox())!.width).toBeGreaterThan(before + 100);
  await page.getByRole("separator", { name: "Resize folders" }).dblclick();
  await expect.poll(async () => Math.round((await explorer.boundingBox())!.width)).toBe(Math.round(before));
});

test("jamais de chemin absolu : la preview montre le chemin depuis la source", async ({ page }) => {
  await full(page);
  const path = (await page.locator(".cr-preview__path").textContent())!;
  expect(path).toMatch(/^Samples\/.+\.(wav|aif)$/);
  expect(await page.locator(".cr-preview__path").getAttribute("title")).toBe(path);
  expect(await page.locator(".cr-table__row[data-selected]").getAttribute("title")).toBe(path);
});
