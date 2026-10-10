// Retours du premier essai sur Mac : lecture auto par défaut, colonne allégée (pas de tonalité, onglets en icônes),
// ⌘← pour tout replier, icônes de type, tags dans le tiroir, Réglages en onglets, taille du texte et couleurs.
import { expect, test, type Page } from "@playwright/test";

/** Ouvre le prototype sur un scénario (touche de la barre de démo). */
async function scenario(page: Page, key: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  // Le prototype écoute le clavier sur la fenêtre : un clic hors du panneau donne le focus à la page.
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press(key);
  await expect(page.locator(".cr-node").first()).toBeVisible();
  return errors;
}

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.querySelector(".cr-panel")!).getPropertyValue(n).trim(), name);

test("lecture auto active par défaut, et coupée depuis le tiroir", async ({ page }) => {
  const errors = await scenario(page, "3"); // Navigation : un kick sélectionné, rien ne joue
  await expect(page.locator(".cr-node[data-playing]")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cr-node[data-selected][data-playing]")).toHaveCount(1);

  await page.getByRole("button", { name: "Lecture auto : activée" }).click();
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("Escape"); // stop
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cr-node[data-selected]")).toHaveCount(1);
  await expect(page.locator(".cr-node[data-playing]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lecture auto : désactivée" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("en colonne : pas de tonalité, onglets en icônes ; en grand : les deux reviennent", async ({ page }) => {
  await scenario(page, "3");
  const lib = page.getByRole("tab", { name: "Bibliothèque" });
  await expect(lib).toHaveText("");
  await expect(lib).toHaveAttribute("title", "Bibliothèque (⌘1)");
  await expect(page.locator(".cr-node .cr-col-key").first()).toHaveCSS("display", "none");
  await expect(page.locator(".cr-node .cr-col-bpm").first()).toHaveCSS("width", "32px"); // le BPM reste

  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator(".cr-panel[data-layout=full]")).toBeVisible();
  await expect(lib).toHaveText("Bibliothèque");
  await expect(page.locator(".cr-node .cr-col-key").first()).toHaveCSS("width", "28px");
});

test("⌘← replie tous les dossiers et remonte au premier niveau", async ({ page }) => {
  const errors = await scenario(page, "3");
  await expect(page.locator('.cr-node[aria-expanded="true"]')).not.toHaveCount(0);
  await page.keyboard.press("Control+ArrowLeft");
  await expect(page.locator('.cr-node[aria-expanded="true"]')).toHaveCount(0);
  await expect(page.locator(".cr-node[aria-level]:not([aria-level='1'])")).toHaveCount(0);
  // Le curseur est sur le dossier de premier niveau qui contenait le kick sélectionné.
  await expect(page.locator(".cr-node[data-selected]")).toHaveAttribute("aria-level", "1");
  expect(errors).toEqual([]);
});

test("une icône de type devant chaque nom : dossier, sample, MIDI", async ({ page }) => {
  await scenario(page, "3");
  await expect(page.locator('.cr-node[data-kind="folder"] .cr-node__icon[data-icon="folder"]').first()).toBeVisible();
  await expect(page.locator('.cr-node[data-kind="sample"] .cr-node__icon[data-icon="sample"]').first()).toBeVisible();

  await page.keyboard.press("Control+f");
  await page.keyboard.type("type:midi ");
  const midi = page.locator('.cr-node[data-kind="sample"] .cr-node__icon');
  await expect(midi.first()).toHaveAttribute("data-icon", "midi");
  await expect(page.locator('.cr-node[data-kind="sample"] .cr-node__icon[data-icon="sample"]')).toHaveCount(0);
});

test("tiroir : ajouter un tag au sample courant, puis le retirer", async ({ page }) => {
  const errors = await scenario(page, "3");
  const tags = page.locator(".cr-drawer__tags");
  await expect(tags).toContainText("Tags :");
  const field = page.getByRole("textbox", { name: "Ajouter un tag" });
  await field.fill("zz-essai");
  await field.press("Enter");
  await expect(tags.locator(".cr-tag", { hasText: "zz-essai" })).toBeVisible();
  await expect(field).toHaveValue("");

  // Suggestion d'un tag existant : « zz » propose « zz-essai » sur un autre sample.
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("ArrowDown");
  await field.fill("zz");
  await expect(page.locator(".cr-drawer__ac .cr-ac__item", { hasText: "zz-essai" })).toBeVisible();
  await field.press("Escape");

  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "Retirer le tag zz-essai" }).click();
  await expect(tags.locator(".cr-tag", { hasText: "zz-essai" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Réglages en onglets : taille du texte et couleurs", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.keyboard.press("Control+,");
  for (const name of ["Sources", "Apparence", "Lecture", "Recherche"]) {
    await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Ajouter un dossier…" })).toBeVisible();
  await page.getByRole("radio", { name: "Lecture", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Lecture auto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un dossier…" })).toBeHidden();

  await page.getByRole("radio", { name: "Apparence", exact: true }).click();
  await page.getByRole("radio", { name: "L", exact: true }).click();
  await expect(page.locator(".cr-panel[data-font-size=lg]")).toBeVisible();
  expect(await cssVar(page, "--cr-fs-sm")).toBe("12px");

  await page.getByLabel("Couleur fond").fill("#ff0000");
  expect(await cssVar(page, "--cr-bg")).toBe("#ff0000");
  await page.getByRole("button", { name: "Rétablir la couleur fond" }).click();
  expect(await cssVar(page, "--cr-bg")).toBe("#232323");

  await page.getByLabel("Couleur sélection").fill("#00aa00");
  await page.getByRole("button", { name: "Rétablir toutes les couleurs" }).click();
  expect(await cssVar(page, "--cr-primary")).toBe("#3d74d9");

  // Les lignes suivent la taille du texte (virtualisation comprise).
  await page.keyboard.press("Escape");
  const box = await page.locator(".cr-node[data-kind=sample]").first().boundingBox();
  expect(box?.height).toBe(26);
  expect(errors).toEqual([]);
});
