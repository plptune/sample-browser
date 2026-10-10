// Filtres temporaires (dossier aplati), icônes de la barre de recherche, waveform sans état intermédiaire.
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

const folder = (page: Page, name: string) => page.locator(".cr-node", { has: page.locator(".cr-node__label", { hasText: new RegExp(`^${name}$`) }) });

test("clic droit › Flatten : tous les samples du dossier, sans sous-dossiers ; filtre retirable", async ({ page }) => {
  const errors = await scenario(page, "3"); // Samples › Drums › Kicks ouverts
  const filters = page.getByRole("button", { name: /^Filters/ });
  await expect(filters).not.toHaveAttribute("data-primary", "true");

  await folder(page, "Drums").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Flatten" }).click();
  const drums = folder(page, "Drums");
  await expect(drums).toHaveAttribute("data-flattened", "true");
  await expect(drums.locator(".cr-node__icon")).toHaveAttribute("data-icon", "folder-flat");
  // Plus de Kicks / Snares sous Drums : ses samples (claps, kicks, snares…) directement au niveau 3.
  await expect(folder(page, "Kicks")).toHaveCount(0);
  await expect(page.locator('.cr-node[data-kind="sample"][aria-level="3"]').first()).toBeVisible();
  // Les claps (Drums › Snares dans les données de démo) et les autres samples suivent Drums, triés par nom.
  await expect(page.locator('.cr-node[data-kind="sample"]', { hasText: "Clap_" }).first()).toHaveAttribute("aria-level", "3");
  await expect(filters).toHaveAttribute("data-primary", "true");
  await expect(filters).toHaveAttribute("aria-label", "Filters (1 active)");

  // Le menu des filtres le liste ; un clic le retire.
  await filters.click();
  await page.getByRole("menuitem", { name: /Flattened: Drums/ }).click();
  await expect(folder(page, "Kicks")).toHaveCount(1);
  await expect(folder(page, "Drums")).not.toHaveAttribute("data-flattened", "true");
  await expect(filters).not.toHaveAttribute("data-primary", "true");
  await filters.click();
  await expect(page.getByRole("menuitem", { name: "No active filters" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("une recherche remet les filtres à zéro ; Unflatten depuis le clic droit", async ({ page }) => {
  await scenario(page, "3");
  await folder(page, "Drums").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Flatten" }).click();
  await expect(folder(page, "Drums")).toHaveAttribute("data-flattened", "true");
  await folder(page, "Drums").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Unflatten" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+f");
  await page.keyboard.type("kick ");
  await expect(page.getByRole("button", { name: "Filters" })).not.toHaveAttribute("data-primary", "true");
  await page.keyboard.press("Escape"); // efface la recherche
  await expect(page.locator(".cr-node[data-flattened]")).toHaveCount(0);
});

test("barre de recherche : engrenage pour les options, entonnoir pour les filtres", async ({ page }) => {
  await scenario(page, "3");
  const gear = await page.getByRole("button", { name: "Search options" }).locator("svg").innerHTML();
  const funnel = await page.getByRole("button", { name: "Filters" }).locator("svg").innerHTML();
  const settings = await page.getByRole("button", { name: "Settings (⌘,)" }).locator("svg").innerHTML();
  expect(new Set([gear, funnel, settings]).size).toBe(3);
  await page.getByRole("button", { name: "Search options" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Flat results" })).toBeVisible();
});

test("waveform du tiroir : jamais de barres ni de forme intermédiaire au changement de sample", async ({ page }) => {
  await scenario(page, "3");
  const canvas = page.locator(".cr-drawer__wave canvas:not(.cr-wave__overlay)");
  await expect(canvas).toHaveAttribute("data-shape", "detail");
  // Enregistre chaque état dessiné pendant quelques ↓.
  await canvas.evaluate((el) => {
    const seen: string[] = [];
    (window as unknown as { __shapes: string[] }).__shapes = seen;
    new MutationObserver(() => seen.push(el.getAttribute("data-shape") ?? "")).observe(el, { attributes: true, attributeFilter: ["data-shape"] });
  });
  await page.locator(".cr-tree").focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
  }
  await expect(canvas).toHaveAttribute("data-shape", "detail");
  const shapes = await page.evaluate(() => (window as unknown as { __shapes: string[] }).__shapes);
  expect(shapes.length).toBeGreaterThan(0);
  expect(shapes.every((s) => s === "none" || s === "detail")).toBe(true);
});
