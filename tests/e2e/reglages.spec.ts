// Bibliothèque vide (premier lancement, ou toutes les sources retirées) : les Réglages doivent rester accessibles,
// pour ajouter une source ou changer le thème. Avant le correctif, l'écran « Glissez un dossier ici » passait devant.
import { expect, test } from "@playwright/test";

test("bibliothèque vide : ⌘, et le bouton Réglages ouvrent les Réglages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  // Le prototype écoute le clavier sur la fenêtre : un clic hors du panneau donne le focus à la page.
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("1"); // scénario « Premier lancement »
  const empty = page.locator(".cr-empty");
  const settings = page.locator(".cr-settings");
  await expect(empty).toBeVisible();

  await page.keyboard.press("Control+,");
  await expect(settings).toBeVisible();
  await expect(empty).toBeHidden();
  await expect(page.getByRole("button", { name: "Add a folder…" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(empty).toBeVisible();

  await page.getByRole("button", { name: "Settings (⌘,)" }).click();
  await expect(settings).toBeVisible();
  expect(errors).toEqual([]);
});
