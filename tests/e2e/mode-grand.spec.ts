// Fenêtre bibliothèque (mode grand) : panneaux Library (dossiers) et Virtual empilés à gauche, preview, recherche et
// liste triable à droite ; la sélection du panneau Library borne la liste (chip path:). On n'y entre et n'en sort que par le bouton ou ⌘⇧F.
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

/** Ce qui borne la liste : le dernier dossier de la chip path: ; « All samples » sans. */
async function scopeLabel(page: Page): Promise<string> {
  const path = page
    .locator(".cr-search__chips .cr-chip")
    .filter({ has: page.locator(".cr-chip__key", { hasText: "path" }) })
    .locator(".cr-chip__val");
  if (await path.count()) return ((await path.first().textContent()) ?? "").replace(/\/$/, "").split("/").pop() ?? "";
  return "All samples";
}
const rowCount = async (page: Page) => Number(await page.getByRole("grid", { name: "Samples" }).getAttribute("aria-rowcount"));

test("explorer de dossiers seuls ; la portée part du dossier du sample, qui reste sélectionné", async ({ page }) => {
  const errors = await full(page);
  const explorer = page.locator(".cr-tree[data-root=library]");
  await expect(explorer.locator('.cr-node[data-kind="sample"]')).toHaveCount(0);
  // Une feuille (Kicks) n'a pas de chevron.
  const kicks = explorer.locator(".cr-node", { hasText: /^Kicks$/ });
  await expect(kicks).not.toHaveAttribute("aria-expanded", /.*/);
  await expect(kicks).toHaveAttribute("data-selected", "true");
  await expect.poll(() => scopeLabel(page)).toBe("Kicks");
  const selected = page.locator(".cr-table__row[data-selected]");
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".cr-node__label")).toHaveText(/^Kick_/);
  await expect(page.locator(".cr-preview__title")).toHaveText((await selected.locator(".cr-node__label").textContent())!);
  expect(errors).toEqual([]);
});

test("cliquer un dossier : toute sa sous-arborescence ; recherche dans la portée ; Échap revient à tout", async ({ page }) => {
  await full(page);
  await page.locator(".cr-tree[data-root=library] .cr-node", { hasText: /^Drums$/ }).click();
  await expect.poll(() => scopeLabel(page)).toBe("Drums");
  const drums = await rowCount(page);
  expect(drums).toBeGreaterThan(34); // plus que Kicks seul : les sous-dossiers comptent

  await page.keyboard.press("Control+f");
  await page.keyboard.type("loop");
  await expect.poll(() => rowCount(page)).toBeLessThan(drums);
  const inDrums = await rowCount(page);
  expect(inDrums).toBeGreaterThan(0);

  // Échap dans l'explorer : plus de portée, la même recherche dans toute la bibliothèque.
  await page.locator(".cr-tree[data-root=library]").focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => scopeLabel(page)).toBe("All samples");
  await expect.poll(() => rowCount(page)).toBeGreaterThan(inDrums);
});

test("tri par en-tête : BPM croissant puis décroissant, les sans-BPM toujours à la fin", async ({ page }) => {
  await full(page);
  await page.locator(".cr-tree[data-root=library] .cr-node", { hasText: /^Samples$/ }).click();
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

test("clavier : Tab passe de la liste à Library, à Virtual, puis à la liste ; ↑ / ↓ dans Library changent la portée", async ({ page }) => {
  await full(page);
  await page.locator(".cr-table__body").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".cr-tree[data-root=library]")).toBeFocused();
  await page.keyboard.press("ArrowUp"); // Kicks → Drums
  await expect.poll(() => scopeLabel(page)).toBe("Drums");
  await page.keyboard.press("Tab");
  await expect(page.locator(".cr-tree[data-root=virtual]")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".cr-tree[data-root=library]")).toBeFocused();
  await page.keyboard.press("Tab");
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

test("glisser une ligne de la liste sur un dossier du panneau Virtual l'y range", async ({ page }) => {
  await full(page);
  const name = (await page.locator(".cr-table__row[data-selected] .cr-node__label").textContent())!;
  const target = page.locator(".cr-tree[data-root=virtual] .cr-node[data-kind=virtual]").first();
  await page.locator(".cr-table__row[data-selected]").dragTo(target);
  // Déplié, le dossier montre le sample (le panneau Virtual a ses samples, la liste n'est pas filtrée).
  await target.dblclick();
  await expect(page.locator(".cr-tree[data-root=virtual] .cr-node[data-kind=sample]", { hasText: name })).toHaveCount(1);
});

test("⌘S : la recherche (chip path: comprise) devient une collection smart, sélectionnée dans le panneau Virtual", async ({ page }) => {
  await full(page);
  await page.locator(".cr-tree[data-root=library] .cr-node", { hasText: /^Drums$/ }).click();
  await page.keyboard.press("Control+f");
  await page.keyboard.type("loop");
  await expect.poll(() => rowCount(page)).toBeGreaterThan(0);
  await page.keyboard.press("Control+s");
  await expect(page.locator(".cr-save__input")).toHaveValue('path:"Samples/Drums/" loop');
  await page.locator(".cr-save__input").fill("Drum loops");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cr-tree[data-root=virtual] .cr-node", { hasText: /^Drum loops$/ })).toHaveAttribute("data-selected", "true");
  // Pas de portée par appartenance : la liste garde sa recherche, sans autre chip.
  await expect(page.locator(".cr-chip--scope")).toHaveCount(0);
  await expect.poll(() => scopeLabel(page)).toBe("Drums");
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

test("jamais de chemin absolu : la preview montre le dossier depuis la source, sans le nom du fichier", async ({ page }) => {
  await full(page);
  const path = (await page.locator(".cr-preview__path").textContent())!;
  expect(path).toBe("Samples/Drums/Kicks/");
  expect(await page.locator(".cr-preview__path").getAttribute("title")).toBe(path);
  // L'infobulle de la ligne garde le chemin du fichier, dans ce dossier.
  const row = (await page.locator(".cr-table__row[data-selected]").getAttribute("title"))!;
  expect(row.startsWith(path) && /\.(wav|aif)$/.test(row)).toBe(true);
});

test("preview : badge du type, tonalité lisible, BPM, extension ; ni temps, ni fréquence, ni bits", async ({ page }) => {
  await full(page);
  const meta = page.locator(".cr-preview__meta");
  await expect(meta.locator(".cr-kind")).toHaveAttribute("aria-label", /^(One-shot|Loop) \(type:/);
  await expect(meta.locator(".cr-preview__ext")).toHaveText(/^(WAV|AIF|AIFF|MIDI)$/);
  await expect(page.locator(".cr-preview__time")).toHaveCount(0);
  await expect(meta).not.toContainText("kHz");
  await expect(meta).not.toContainText("bits");
  await expect(meta).not.toContainText("Key");
  // Un sample avec tonalité et tempo, dans toute la bibliothèque : « A minor » plutôt que « Am », « 120 BPM ».
  await page.locator(".cr-tree[data-root=library]").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("key:Am bpm:>1 ");
  await page.locator(".cr-table__row").first().click();
  await expect(meta.locator(".cr-preview__key")).toHaveText("A minor");
  await expect(meta.locator(".cr-preview__bpm")).toHaveText(/^\d+(\.\d+)? BPM$/);
});
