// Expanded : panneaux Library et Virtual empilés à gauche, chacun masquable (⌘1 / ⌘2, boutons de la barre titre),
// séparés par un séparateur tirable ; le panneau Virtual a ses samples et ne filtre jamais la liste.
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

const LIB = ".cr-tree[data-root=library]";
const VIRT = ".cr-tree[data-root=virtual]";
const libButton = (page: Page) => page.getByRole("button", { name: "Library panel (⌘1)" });
const virtButton = (page: Page) => page.getByRole("button", { name: "Virtual panel (⌘2)" });
const pathChips = (page: Page) =>
  page.locator(".cr-search__chips .cr-chip").filter({ has: page.locator(".cr-chip__key", { hasText: "path" }) });
const rowCount = async (page: Page) => Number(await page.getByRole("grid", { name: "Samples" }).getAttribute("aria-rowcount"));
const height = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!.height;

test("deux panneaux par défaut ; ⌘1 / ⌘2 les masquent ; sans panneau, la liste prend toute la largeur", async ({ page }) => {
  const errors = await full(page);
  await expect(page.locator(LIB)).toBeVisible();
  await expect(page.locator(VIRT)).toBeVisible();
  await expect(libButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(virtButton(page)).toHaveAttribute("aria-pressed", "true");
  // Les épinglés virtuels ne sont plus dans Library (le panneau Virtual les montre) ; le raccourci reste.
  await expect(page.locator(`${LIB} .cr-node[data-kind=virtual], ${LIB} .cr-node[data-kind=favorites]`)).toHaveCount(0);
  await expect(page.locator(`${LIB} .cr-node[data-kind=shortcut]`)).toHaveCount(1);

  await page.keyboard.press("Control+1");
  await expect(page.locator(LIB)).toHaveCount(0);
  await expect(libButton(page)).toHaveAttribute("aria-pressed", "false");
  // Virtual seul : toute la hauteur de la colonne.
  await expect.poll(async () => Math.round(await height(page, ".cr-pane[data-root=virtual]"))).toBe(Math.round(await height(page, ".cr-explorer")));

  await page.keyboard.press("Control+2");
  await expect(page.locator(".cr-explorer")).toHaveCount(0);
  await expect(virtButton(page)).toHaveAttribute("aria-pressed", "false");
  const fullW = (await page.locator(".cr-full").boundingBox())!.width;
  expect(Math.round((await page.locator(".cr-full__main").boundingBox())!.width)).toBe(Math.round(fullW));

  // Le bouton réaffiche le panneau.
  await libButton(page).click();
  await expect(page.locator(LIB)).toBeVisible();
  await expect(page.locator(".cr-full")).toHaveAttribute("data-panels", "1");
  expect(errors).toEqual([]);
});

test("panneau Virtual : un clic ne filtre pas la liste ; double-clic déplie ses samples ; un sample va dans la preview", async ({ page }) => {
  await full(page);
  const before = await rowCount(page);
  const pack = page.locator(`${VIRT} .cr-node`, { hasText: /^Pack 2026$/ });
  await pack.click();
  await expect(pack).toHaveAttribute("data-selected", "true");
  await expect(pathChips(page)).toHaveCount(1); // la chip du dossier d'entrée, inchangée
  await expect(page.locator(".cr-chip--scope")).toHaveCount(0);
  expect(await rowCount(page)).toBe(before);
  await expect(page.locator(".cr-table__row[data-selected]")).toHaveCount(1);

  await pack.dblclick();
  const sample = page.locator(`${VIRT} .cr-tree__row[data-key$="@v:3"] .cr-node`).first();
  await expect(sample).toBeVisible();
  const name = (await sample.locator(".cr-node__label").textContent())!;
  await sample.click();
  await expect(page.locator(".cr-preview__title")).toHaveText(name);
  await expect(sample).toHaveAttribute("data-selected", "true");
  // Une seule sélection de samples : celle de la liste est vidée.
  await expect(page.locator(".cr-table__row[data-selected]")).toHaveCount(0);
  // Et l'inverse : un clic dans la liste vide celle du panneau.
  await page.locator(".cr-table__row").first().click();
  await expect(page.locator(`${VIRT} .cr-node[data-selected]`)).toHaveCount(0);
});

test("séparateur horizontal : tirer agrandit Library ; double-clic revient à la moitié", async ({ page }) => {
  await full(page);
  const pane = ".cr-pane[data-root=library]";
  const before = await height(page, pane);
  const sep = page.getByRole("separator", { name: "Resize panels" });
  await expect(sep).toHaveAttribute("aria-orientation", "horizontal");
  const s = (await sep.boundingBox())!;
  await page.mouse.move(s.x + 100, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + 100, s.y + s.height / 2 + 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => height(page, pane)).toBeGreaterThan(before + 100);
  // Jamais sous la hauteur minimale de Virtual.
  await page.mouse.move(s.x + 100, s.y + 120);
  await page.mouse.down();
  await page.mouse.move(s.x + 100, 2000, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => height(page, ".cr-pane[data-root=virtual]")).toBeGreaterThanOrEqual(119);
  await sep.dblclick();
  await expect.poll(async () => Math.round(await height(page, pane))).toBe(Math.round(before));
});

test("⌘N avec le panneau Virtual masqué : il revient, le nouveau dossier en renommage", async ({ page }) => {
  await full(page);
  await page.keyboard.press("Control+2");
  await expect(page.locator(VIRT)).toHaveCount(0);
  await page.keyboard.press("Control+n");
  await expect(page.locator(VIRT)).toBeVisible();
  await expect(virtButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${VIRT} input`)).toBeFocused();
});

test("ressort : glisser une ligne sur le bouton d'un panneau masqué le réaffiche après 500 ms", async ({ page }) => {
  await full(page);
  await page.keyboard.press("Control+2");
  await expect(page.locator(VIRT)).toHaveCount(0);
  await page.locator(".cr-table__row[data-selected]").hover();
  await page.mouse.down();
  const b = (await virtButton(page).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2, { steps: 2 });
  await expect(page.locator(VIRT)).toBeVisible({ timeout: 2000 });
  await page.mouse.up();
});

test("colonne → Expanded depuis un dossier virtuel : le sample sélectionné dans le panneau Virtual, sans chip path:", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("3");
  await expect(page.locator(".cr-node[data-selected]")).toHaveCount(1);
  await page.keyboard.press("Control+2"); // onglet Virtuals
  await page.locator(".cr-node", { hasText: /^Pack 2026$/ }).dblclick();
  const sample = page.locator('.cr-tree__row[data-key$="@v:3"] .cr-node').first();
  const name = (await sample.locator(".cr-node__label").textContent())!;
  await sample.click();
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator(".cr-panel[data-layout=full]")).toBeVisible();
  const selected = page.locator(`${VIRT} .cr-node[data-selected]`);
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".cr-node__label")).toHaveText(name);
  await expect(pathChips(page)).toHaveCount(0);
  await expect(page.locator(".cr-preview__title")).toHaveText(name);
  await expect(page.locator(".cr-table__row[data-selected]")).toHaveCount(0);
});
