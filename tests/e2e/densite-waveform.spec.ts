// Densité « waveform » : les lignes de l'arbre portent une mini waveform ; une recherche qui remplace les lignes
// affichées ne doit rien évaluer sur une ligne qui n'est plus là.
import { expect, test, type Page } from "@playwright/test";

async function scenario(page: Page, key: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack ?? ""}`));
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press(key);
  await expect(page.locator(".cr-node").first()).toBeVisible();
  return errors;
}

test("densité « waveform » : une recherche remplace les lignes sans erreur", async ({ page }) => {
  const errors = await scenario(page, "3"); // Samples › Drums › Kicks ouverts
  await page.getByRole("button", { name: "Settings (⌘,)" }).click();
  await page.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: "Appearance" }).click();
  await page.getByRole("radiogroup", { name: "Density" }).getByRole("radio", { name: "Waveform" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('.cr-node[data-kind="sample"][data-wave]').first()).toBeVisible();

  await page.locator(".cr-search__input").click();
  await page.keyboard.type("type:midi ");
  await expect(page.locator('.cr-node[data-kind="sample"] [data-icon="midi"]').first()).toBeVisible();
  // L'arbre suit la recherche : plus aucune ligne audio.
  await expect(page.locator('.cr-node[data-kind="sample"] [data-icon="sample"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
