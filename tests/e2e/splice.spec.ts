// Tags Splice (Réglages › Sources) : la synchronisation ajoute des tags atténués ; un tag retiré ne revient pas.
import { expect, test } from "@playwright/test";

test("synchroniser les tags Splice, en retirer un, resynchroniser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("3");
  await expect(page.locator(".cr-node").first()).toBeVisible();
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Sync Splice tags" }).click();
  const status = page.getByRole("status").filter({ hasText: "Splice samples found" });
  await expect(status).toContainText(/tags added$/);
  await expect(status).not.toContainText(" 0 tags added");

  // Retour à la liste : un sample tagué `house` par Splice, atténué.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("#house ");
  const first = page.locator('.cr-node[data-kind="sample"]').first();
  await first.click();
  const name = (await first.innerText()).split("\n")[0].trim();
  const house = page.locator(".cr-drawer__tags .cr-tag", { hasText: /^house$/ });
  await expect(house).toHaveAttribute("data-auto", "true");
  await expect(house).toHaveAttribute("title", "From Splice");
  await page.getByRole("button", { name: "Remove tag house" }).click();
  // Il ne répond plus à `#house` (la sélection passe au suivant).
  await expect(page.locator('.cr-node[data-kind="sample"]', { hasText: name })).toHaveCount(0);

  // Rien de nouveau, et le tag retiré n'est pas reposé.
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "Sync Splice tags" }).click();
  await expect(status).toContainText("· 0 tags added");
  expect(errors).toEqual([]);
});
