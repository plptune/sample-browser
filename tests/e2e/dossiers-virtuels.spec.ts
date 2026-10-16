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

test("pendant un glisser, tout le bloc de la cible s'éclaire : ses descendants visibles, pas ses parents", async ({ page }) => {
  await scenario(page);
  const from = await center(page, "v:2"); // Night Drive, sous Projects
  const to = await center(page, "v:3"); // Pack 2026, ouvert : Drums, Textures, puis ses Risers
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(node(page, "v:3")).toHaveAttribute("data-drop-target", "true");
  await expect(node(page, "v:4")).toHaveAttribute("data-drop-block", "true");
  await expect(node(page, "v:5")).toHaveAttribute("data-drop-block", "true");
  const risers = page.locator('.cr-tree__row[data-key$="@v:3"] .cr-node');
  await expect(risers.first()).toHaveAttribute("data-drop-block", "true");
  await expect(node(page, "v:1")).not.toHaveAttribute("data-drop-block", /.*/);
  // Survoler un sample du bloc vise toujours le dossier.
  const r = (await risers.first().boundingBox())!;
  await page.mouse.move(r.x + 40, r.y + r.height / 2, { steps: 4 });
  await expect(node(page, "v:3")).toHaveAttribute("data-drop-target", "true");
  await page.mouse.up();
  await expect(page.locator("[data-drop-target], [data-drop-block]")).toHaveCount(0);
});

test("un dossier virtuel ne se dépose pas dans l'un de ses descendants", async ({ page }) => {
  await scenario(page);
  const from = await center(page, "v:3"); // Pack 2026
  const to = await center(page, "v:4"); // Drums, son enfant
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator(".cr-node[data-drop-target]")).toHaveCount(0);
  await page.mouse.up();
  await expect(node(page, "v:4")).toHaveAttribute("aria-level", "2");
});

test("fichiers d'une autre app (Finder, Sononym) déposés sur un dossier virtuel : ajoutés ; hors source : un message", async ({ page }) => {
  const errors = await scenario(page);
  const drop = (method: string, ...args: unknown[]) =>
    page.evaluate(([m, a]) => (globalThis as any).__crateDrop[m as string](...(a as unknown[])), [method, args] as const);
  const to = await center(page, "v:4"); // Drums, sous Pack 2026
  // Un dossier de la bibliothèque : tous ses sons.
  await drop("enter", ["~/Music/Samples/Drums/Hats"]);
  await drop("over", to.x, to.y);
  await expect(node(page, "v:4")).toHaveAttribute("data-drop-target", "true");
  await drop("drop", ["~/Music/Samples/Drums/Hats"], to.x, to.y);
  await expect(page.locator("[data-drop-target]")).toHaveCount(0);
  await node(page, "v:4").dblclick();
  await expect(page.locator('.cr-tree__row[data-key$="@v:4"] .cr-node__label', { hasText: /^OpenHat_/ }).first()).toBeVisible();

  // Un fichier hors de toute source : refusé, avec un message.
  await drop("enter", ["/Users/someone/Downloads/thing.wav"]);
  await drop("over", to.x, to.y);
  await drop("drop", ["/Users/someone/Downloads/thing.wav"], to.x, to.y);
  await expect(page.locator(".cr-notice")).toHaveText("This file isn't in any of your sources.");
  expect(errors).toEqual([]);
});
