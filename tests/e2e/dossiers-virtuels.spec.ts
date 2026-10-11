// Glisser d'un dossier virtuel, au pointeur (pas en HTML5) : dans un autre dossier, au fond de l'onglet (racine),
// simple clic en deçà de 4 px, défilement de l'arbre près de son bord.
import { expect, test, type Page } from "@playwright/test";

async function scenario(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("body").click({ position: { x: 5, y: page.viewportSize()!.height - 20 } });
  await page.keyboard.press("["); // Virtuels : Projects › Night Drive ; Pack 2026 › Drums, Textures
  await expect(page.locator(".cr-node").first()).toBeVisible();
  return errors;
}

const node = (page: Page, key: string) => page.locator(`.cr-tree__row[data-key="${key}"] .cr-node`);

async function center(page: Page, key: string) {
  const b = (await node(page, key).boundingBox())!;
  return { x: b.x + 40, y: b.y + b.height / 2 };
}

async function top(page: Page, key: string) {
  return (await node(page, key).boundingBox())!.y;
}

test("glisser un dossier virtuel dans un autre", async ({ page }) => {
  const errors = await scenario(page);
  const from = await center(page, "v:2"); // Night Drive, sous Projects
  const to = await center(page, "v:3"); // Pack 2026
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(node(page, "v:3")).toHaveAttribute("data-drop-target", "true");
  await expect(node(page, "v:2")).toHaveAttribute("data-dragging", "true");
  await expect(page.locator(".cr-drag-ghost")).toHaveText("Night Drive");
  await page.mouse.up();
  await expect(page.locator(".cr-drag-ghost")).toHaveCount(0);
  // Rangé par nom sous Pack 2026 : Drums, Night Drive, Textures.
  await expect(node(page, "v:2")).toHaveAttribute("aria-level", "2");
  expect(await top(page, "v:2")).toBeGreaterThan(await top(page, "v:4"));
  expect(await top(page, "v:2")).toBeLessThan(await top(page, "v:5"));
  await expect(page.locator("[data-drop-target], [data-dragging]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("glisser un dossier virtuel sur le fond : il remonte à la racine", async ({ page }) => {
  const errors = await scenario(page);
  const tree = (await page.locator(".cr-tree").boundingBox())!;
  const space = (await page.locator(".cr-tree__space").boundingBox())!;
  // Le fond : sous la dernière ligne, hors de la bande de défilement.
  const y = Math.min(space.y + space.height + 10, tree.y + tree.height - 40);
  const from = await center(page, "v:4"); // Drums, sous Pack 2026
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, y, { steps: 8 });
  await expect(page.locator(".cr-tree")).toHaveAttribute("data-drop-target", "true");
  await page.mouse.up();
  await expect(node(page, "v:4")).toHaveAttribute("aria-level", "1");
  expect(errors).toEqual([]);
});

test("un appui sans mouvement reste un clic", async ({ page }) => {
  const errors = await scenario(page);
  const from = await center(page, "v:2");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 1);
  await page.mouse.up();
  await expect(page.locator(".cr-drag-ghost")).toHaveCount(0);
  await expect(node(page, "v:2")).toHaveAttribute("data-selected", "true");
  await expect(node(page, "v:2")).toHaveAttribute("aria-level", "2");
  expect(errors).toEqual([]);
});

test("près du bord bas de l'arbre, le glisser le fait défiler", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 480 });
  const errors = await scenario(page);
  const tree = page.locator(".cr-tree");
  await expect.poll(() => tree.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const box = (await tree.boundingBox())!;
  const from = await center(page, "v:1");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, box.y + box.height - 6, { steps: 8 });
  await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(40);
  // Lâché hors de l'arbre : rien ne bouge.
  await page.mouse.move(from.x, 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".cr-drag-ghost")).toHaveCount(0);
  expect(errors).toEqual([]);
});
