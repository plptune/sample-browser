// Filtre path: (chemin depuis la source) ; en Expanded, un vrai dossier choisi dans le panneau Library pose cette chip,
// un dossier du panneau Virtual ne filtre rien ; bouton « New folder ».
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

const chips = (page: Page) => page.locator(".cr-search__chips .cr-chip");
const pathChips = (page: Page) => chips(page).filter({ has: page.locator(".cr-chip__key", { hasText: "path" }) });
const rowCount = async (page: Page) => Number(await page.getByRole("grid", { name: "Samples" }).getAttribute("aria-rowcount"));
const explorerNode = (page: Page, name: string) => page.locator(".cr-tree[data-root=library] .cr-node", { hasText: new RegExp(`^${name}$`) });
const virtualNode = (page: Page, name: string) => page.locator(".cr-tree[data-root=virtual] .cr-node", { hasText: new RegExp(`^${name}$`) });

test("Expanded : un vrai dossier de l'explorer pose une chip path:, remplacée au choix suivant ; Échap la retire", async ({ page }) => {
  const errors = await full(page);
  // En entrant, le dossier du sample (Kicks) est déjà une chip.
  await expect(pathChips(page)).toHaveCount(1);
  await expect(pathChips(page).locator(".cr-chip__val")).toHaveText("Samples/Drums/Kicks/");
  await explorerNode(page, "Drums").click();
  await expect(pathChips(page)).toHaveCount(1);
  await expect(pathChips(page).locator(".cr-chip__val")).toHaveText("Samples/Drums/");
  await expect(explorerNode(page, "Drums")).toHaveAttribute("data-scoped", "true");
  const drums = await rowCount(page);
  expect(drums).toBeGreaterThan(34); // sous-dossiers compris
  // Chaque ligne est bien sous Samples/Drums/.
  const titles = await page.locator(".cr-table__row").evaluateAll((rows) => rows.map((r) => r.getAttribute("title") ?? ""));
  expect(titles.every((t) => t.startsWith("Samples/Drums/"))).toBe(true);

  await page.locator(".cr-tree[data-root=library]").focus();
  await page.keyboard.press("Escape");
  await expect(pathChips(page)).toHaveCount(0);
  await expect.poll(() => rowCount(page)).toBeGreaterThan(drums);
  expect(errors).toEqual([]);
});

test("retirer la chip à la main efface aussi la marque de l'explorer ; une chip path: tapée survit à un clic", async ({ page }) => {
  await full(page);
  await explorerNode(page, "Drums").click();
  await page.keyboard.press("Control+f");
  await page.keyboard.press("Backspace"); // champ vide : retire la dernière chip
  await expect(pathChips(page)).toHaveCount(0);
  await expect(page.locator(".cr-explorer .cr-node[data-scoped]")).toHaveCount(0);

  // Une chip tapée à la main, puis un dossier choisi : les deux restent (elles se combinent).
  await page.keyboard.type("-path:Drums/Kicks ");
  await expect(pathChips(page)).toHaveCount(1);
  await explorerNode(page, "Drums").click();
  await expect(pathChips(page)).toHaveCount(2);
  const titles = await page.locator(".cr-table__row").evaluateAll((rows) => rows.map((r) => r.getAttribute("title") ?? ""));
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.every((t) => t.startsWith("Samples/Drums/") && !t.startsWith("Samples/Drums/Kicks/"))).toBe(true);
});

test("Expanded, panneau Virtual : un dossier virtuel ne pose ni chip ni portée", async ({ page }) => {
  await full(page);
  const before = await rowCount(page);
  const vf = page.locator(".cr-tree[data-root=virtual] .cr-node[data-kind=virtual]").first();
  await vf.click();
  await expect(vf).toHaveAttribute("data-selected", "true");
  await expect(vf).not.toHaveAttribute("data-scoped", /.*/);
  // Seule la chip du dossier d'entrée (Kicks) reste ; la liste ne change pas.
  await expect(chips(page)).toHaveCount(1);
  await expect(pathChips(page).locator(".cr-chip__val")).toHaveText("Samples/Drums/Kicks/");
  await expect(page.locator(".cr-chip--scope")).toHaveCount(0);
  expect(await rowCount(page)).toBe(before);
});

test("taper path: propose les dossiers ; le choix pose la chip entre guillemets", async ({ page }) => {
  await full(page);
  await page.locator(".cr-tree[data-root=library]").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("path:lofi");
  const items = page.locator(".cr-ac__item");
  await expect(items.first()).toHaveText('path:"Splice/packs/Lofi Keys/"');
  await page.keyboard.press("Enter");
  await expect(pathChips(page).locator(".cr-chip__val")).toHaveText("Splice/packs/Lofi Keys/");
  await expect(page.locator(".cr-search__input")).toHaveValue("");
  const titles = await page.locator(".cr-table__row").evaluateAll((rows) => rows.map((r) => r.getAttribute("title") ?? ""));
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.every((t) => t.startsWith("Splice/packs/Lofi Keys/"))).toBe(true);
});

test("bouton « New folder » : libellé en Expanded, icône seule en colonne ; un clic crée un dossier à renommer", async ({ page }) => {
  await full(page);
  const button = page.getByRole("button", { name: "New folder" });
  await expect(button).toHaveAttribute("title", "New virtual folder (⌘N)");
  await button.click();
  await expect(page.locator(".cr-explorer input")).toBeFocused();
  await page.keyboard.type("Drafts");
  await page.keyboard.press("Enter");
  await expect(virtualNode(page, "Drafts")).toHaveCount(1);

  await page.getByRole("radio", { name: "Side panel (⌘⇧F)" }).click();
  await expect(page.locator(".cr-panel[data-layout=side]")).toBeVisible();
  // En colonne, le bouton est celui de l'onglet Virtuals.
  await expect(page.getByRole("button", { name: "New virtual folder (⌘N)" })).toHaveCount(0);
  await page.keyboard.press("Control+2");
  await expect(page.getByRole("button", { name: "New virtual folder (⌘N)" })).toHaveText("");
  await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
});
