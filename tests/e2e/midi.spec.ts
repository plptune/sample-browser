// Fichiers MIDI : leurs notes en piano roll (hauteur × temps) à la place de la forme d'onde, dans le tiroir, la preview
// du mode grand et les lignes de l'arbre en densité « waveform » ; les samples audio gardent leur onde.
import { expect, test, type Locator, type Page } from "@playwright/test";

async function scenario(page: Page, key: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press(key);
  await expect(page.locator(".cr-node").first()).toBeVisible();
  return errors;
}

async function searchMidi(page: Page) {
  await page.locator(".cr-search__input").click();
  await page.keyboard.type("type:midi ");
}

const folder = (page: Page, name: string) =>
  page.locator('.cr-node:not([data-kind="sample"])', { has: page.locator(".cr-node__label", { hasText: new RegExp(`^${name}$`) }) });

/** Pixels dessinés (alpha non nul) : le canvas n'est pas vide. */
const inked = (canvas: Locator) =>
  canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });

test("tiroir : un fichier MIDI montre ses notes, un sample audio sa forme d'onde", async ({ page }) => {
  const errors = await scenario(page, "3"); // un kick sélectionné
  const canvas = page.locator(".cr-drawer__wave canvas:not(.cr-wave__overlay)");
  await expect(canvas).toHaveAttribute("data-shape", "detail");
  await expect(canvas).not.toHaveAttribute("data-notes", /.*/);

  await searchMidi(page);
  await page.locator('.cr-node[data-kind="sample"]', { hasText: "Lofi_Chords_90_Am" }).click();
  // 4 mesures, un accord de 4 notes par mesure.
  await expect(canvas).toHaveAttribute("data-shape", "notes");
  await expect(canvas).toHaveAttribute("data-notes", "16");
  await expect.poll(() => inked(canvas)).toBeGreaterThan(0);

  // Un autre clip : ses propres notes (une basse, une note par temps sur 2 mesures).
  await page.locator('.cr-node[data-kind="sample"]', { hasText: "Bass_Line_90_Am" }).click();
  await expect(canvas).toHaveAttribute("data-notes", "8");
  expect(errors).toEqual([]);
});

test("mode grand : la preview d'un fichier MIDI montre ses notes", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  const errors = await scenario(page, "3");
  await page.getByRole("button", { name: "Expanded (⌘⇧F)" }).click();
  await expect(page.locator(".cr-panel[data-layout=full]")).toBeVisible();
  const canvas = page.locator(".cr-preview__wave canvas:not(.cr-wave__overlay)");
  await expect(canvas).toHaveAttribute("data-shape", "detail");

  // Échap dans l'explorer : plus de portée (Kicks), la recherche porte sur toute la bibliothèque.
  await page.locator(".cr-tree[data-root=library]").focus();
  await page.keyboard.press("Escape");
  await searchMidi(page);
  await page.locator(".cr-table__row", { hasText: "Melody_Loop_120_Em" }).click();
  await expect(canvas).toHaveAttribute("data-shape", "notes");
  await expect(canvas).toHaveAttribute("data-notes", "16");
  await expect.poll(() => inked(canvas)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("densité « waveform » : les lignes MIDI montrent leurs notes, les lignes audio leur onde", async ({ page }) => {
  const errors = await scenario(page, "3"); // Samples › Drums › Kicks ouverts
  // Splice › packs › Lofi Keys › MIDI, ouverts un à un (double-clic), avant de passer en densité « waveform ».
  for (const name of ["Splice", "packs", "Lofi Keys", "MIDI"]) await folder(page, name).dblclick();
  await page.getByRole("button", { name: "Settings (⌘,)" }).click();
  await page.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: "Appearance" }).click();
  await page.getByRole("radiogroup", { name: "Density" }).getByRole("radio", { name: "Waveform" }).click();
  await page.keyboard.press("Escape");

  const row = page.locator('.cr-node[data-kind="sample"]', { hasText: "Lofi_Chords_90_Am" });
  await expect(row.locator(".cr-node__icon")).toHaveAttribute("data-icon", "midi");
  const mini = row.locator("canvas.cr-node__wave");
  await expect(mini).toHaveAttribute("data-shape", "notes");
  await expect(mini).toHaveAttribute("data-notes", "16");
  await expect.poll(() => inked(mini)).toBeGreaterThan(0);

  // Les lignes audio (Kicks, plus bas) gardent leur onde.
  const audio = page.locator('.cr-node[data-kind="sample"]:has([data-icon="sample"]) canvas.cr-node__wave').first();
  await audio.scrollIntoViewIfNeeded();
  await expect(audio).not.toHaveAttribute("data-shape", "notes");
  await expect.poll(() => inked(audio)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
