// Tags automatiques : posés par l'analyse (atténués), × les retire ; le type (loop / oneshot) s'affiche comme un tag.
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

test("tiroir : le type puis les tags, ceux de l'analyse atténués ; × retire un tag auto", async ({ page }) => {
  const errors = await scenario(page, "3"); // un kick sélectionné
  const tags = page.locator(".cr-drawer__tags");
  // Le type à part, avant les tags : « Type: » puis son badge (texte dans l'infobulle et le nom accessible), « Tags: ».
  await expect(tags.locator(".cr-drawer__label")).toHaveText(["Type:", "Tags:"]);
  await expect(tags.locator(".cr-kind")).toHaveAttribute("aria-label", "One-shot (type:oneshot)");
  const kick = tags.locator(".cr-tag", { hasText: /^kick$/ });
  await expect(kick).toHaveAttribute("data-auto", "true");
  await expect(kick).toHaveCSS("font-style", "italic");
  await page.getByRole("button", { name: "Remove tag kick" }).click();
  await expect(tags.locator(".cr-tag", { hasText: /^kick$/ })).toHaveCount(0);
  // Le type n'est pas retirable.
  await expect(page.getByRole("button", { name: "Remove tag oneshot" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("ajouter soi-même un tag auto le rend normal", async ({ page }) => {
  await scenario(page, "3");
  const tags = page.locator(".cr-drawer__tags");
  await page.getByLabel("Add a tag").fill("KICK");
  await page.keyboard.press("Enter");
  await expect(tags.locator(".cr-tag", { hasText: /^kick$/ })).not.toHaveAttribute("data-auto", /.*/);
});

test("recherche : #loop et #kick, proposés par l'autocomplétion", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("#lo");
  await expect(page.locator(".cr-ac").getByText("#loop", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.type("op ");
  // Premier résultat : une boucle (son premier tag est son type).
  await page.locator('.cr-node[data-kind="sample"]').first().click();
  await expect(page.locator(".cr-drawer__tags .cr-kind")).toHaveAttribute("data-kind", "loop");
  expect(errors).toEqual([]);
});

test("mode grand : colonne Type, colonne Tags avec les tags auto en italique", async ({ page }) => {
  await scenario(page, "3");
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.keyboard.press("Control+Shift+F");
  const col = page.locator(".cr-node[data-selected] .cr-col-tags");
  // Le type a sa colonne ; celle des tags n'a plus que les tags.
  await expect(page.locator(".cr-node[data-selected] .cr-col-kind .cr-kind")).toHaveAttribute("aria-label", "One-shot (type:oneshot)");
  await expect(col.locator(".cr-kind")).toHaveCount(0);
  await expect(col.locator('.cr-col-tags__tag[data-auto]', { hasText: "kick" })).toHaveCSS("font-style", "italic");
});
