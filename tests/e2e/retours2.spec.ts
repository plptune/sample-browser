// Retours n° 2 : tiroir réorganisé, explorer épuré (nom.ext, lignes de parenté), ← / →, recherche (↓ sur les samples
// seulement, résultats à plat), onglets à icônes distinctes, interface en anglais.
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

test("tiroir : tags, chemin relatif, nom, waveform ; plus de durée", async ({ page }) => {
  const errors = await scenario(page, "6"); // Lecture : un sample de « Night Textures » sélectionné
  const order = await page.locator(".cr-drawer > *").evaluateAll((els) => els.map((e) => e.className.split(" ")[0]));
  expect(order).toEqual(["cr-drawer__tags", "cr-drawer__path", "cr-drawer__head", "cr-drawer__wave"]);
  await expect(page.locator(".cr-drawer__time")).toHaveCount(0);
  // Relatif à la source (« Splice »), dossiers de plus de 10 caractères coupés.
  await expect(page.locator(".cr-drawer__path")).toHaveText("packs/Night Text…/");
  const path = await page.locator(".cr-drawer__path").evaluate((e) => ({ ws: getComputedStyle(e).whiteSpace, h: e.getBoundingClientRect().height }));
  expect(path.ws).toBe("nowrap");
  expect(path.h).toBeLessThan(20);
  await expect(page.locator(".cr-drawer__title")).toHaveText(/\.(wav|aif)$/);
  // Forme d'onde : canvas de la forme + canvas de la tête de lecture.
  await expect(page.locator(".cr-drawer canvas.cr-wave__overlay")).toHaveCount(1);
  // Clic dans la waveform à l'arrêt : la lecture part de ce point.
  await page.locator("body").click({ position: { x: 5, y: 880 } });
  await page.keyboard.press("Escape");
  await expect(page.locator(".cr-node[data-playing]")).toHaveCount(0);
  const wave = await page.locator(".cr-drawer__wave").boundingBox();
  await page.mouse.click(wave!.x + wave!.width * 0.6, wave!.y + wave!.height / 2);
  await expect(page.locator(".cr-node[data-playing]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("explorer en colonne : icône + nom.ext, rien d'autre ; lignes de parenté", async ({ page }) => {
  await scenario(page, "3");
  const sample = page.locator('.cr-node[data-kind="sample"]').first();
  await expect(sample.locator(".cr-node__label")).toHaveText(/^Kick_\w+\.(wav|aif)$/);
  await expect(page.locator(".cr-node .cr-col-bpm")).toHaveCount(0);
  await expect(page.locator(".cr-node .cr-col-key")).toHaveCount(0);
  // Une ligne au 4e niveau porte 3 traits de parenté (pseudo-élément large de 3 retraits).
  const deep = page.locator('.cr-node[aria-level="4"]').first();
  const w = await deep.evaluate((e) => getComputedStyle(e, "::before").width);
  expect(w).toBe("36px");
  // En mode grand, les colonnes reviennent.
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator(".cr-node .cr-col-bpm").first()).toHaveCSS("width", "32px");
});

test("← ferme et remonte au parent, → ouvre sans entrer", async ({ page }) => {
  const errors = await scenario(page, "3"); // Kicks ouvert, un kick sélectionné
  await page.locator(".cr-tree").focus();
  await page.keyboard.press("ArrowLeft");
  const sel = page.locator(".cr-node[data-selected]");
  await expect(sel).toHaveAttribute("data-kind", "folder");
  await expect(sel).toHaveAttribute("aria-expanded", "false");
  await expect(sel.locator(".cr-node__label")).toHaveText("Kicks");
  await page.keyboard.press("ArrowRight");
  await expect(sel).toHaveAttribute("aria-expanded", "true");
  await expect(sel.locator(".cr-node__label")).toHaveText("Kicks"); // le curseur reste sur le dossier
  await page.keyboard.press("ArrowRight"); // déjà ouvert : rien
  await expect(sel.locator(".cr-node__label")).toHaveText("Kicks");
  await page.keyboard.press("ArrowLeft");
  await expect(sel).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("recherche : ↓ ne s'arrête que sur des samples ; résultats à plat", async ({ page }) => {
  const errors = await scenario(page, "3");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("kick ");
  await page.keyboard.press("ArrowDown"); // dans l'arbre
  for (let i = 0; i < 16; i++) {
    await expect(page.locator(".cr-node[data-selected]")).toHaveAttribute("data-kind", "sample");
    await page.keyboard.press("ArrowDown");
  }
  // Menu d'options → résultats à plat : plus aucune ligne dossier, tout au premier niveau.
  await page.getByRole("button", { name: "Search options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Flat results" }).click();
  await expect(page.locator('.cr-node[data-kind="folder"]')).toHaveCount(0);
  await expect(page.locator(".cr-node").first()).toHaveAttribute("aria-level", "1");
  await expect(page.locator('.cr-node[data-kind="sample"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Search options" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Flat results" })).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("champ de recherche : ni loupe ni contour au focus", async ({ page }) => {
  await scenario(page, "3");
  await expect(page.locator(".cr-search .cr-icon").first()).not.toHaveAttribute("class", /search/);
  await page.keyboard.press("Control+f");
  await expect(page.locator(".cr-search__input")).toHaveCSS("outline-style", "none");
  // Collé à l'explorer : pas de marge sous le champ.
  await expect(page.locator(".cr-panel__search")).toHaveCSS("padding-bottom", "0px");
});

test("onglets : deux icônes différentes", async ({ page }) => {
  await scenario(page, "3");
  const lib = await page.getByRole("tab", { name: "Library" }).locator("svg").innerHTML();
  const virt = await page.getByRole("tab", { name: "Virtual" }).locator("svg").innerHTML();
  expect(lib).not.toBe(virt);
});

test("interface en anglais : aucun texte français visible", async ({ page }) => {
  await scenario(page, "3");
  const FR = /[éèàùâêîôûçÉÈÀ«»]|\b(le|la|les|une|des|du|et|pour|dans|avec|sans|aucun|Lire|Retirer|Ajouter|Rechercher|Réglages|Dossier|dossier|Nouveau|Nouvelle|Créer|Copier|Afficher|Masquer|Renommer|Supprimer|Ouvrir|Fermer|Glissez|Boucle|Sombre|Clair|Taille|Couleur|Fond|Raccourci|Choisissez|Projets)\b/;
  const found: string[] = [];
  const scan = async (where: string) => {
    const texts = await page.evaluate(() => {
      const out: string[] = [];
      const root = document.querySelector(".demo-window") ?? document.body;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.trim()) out.push(n.textContent.trim());
      for (const el of root.querySelectorAll("[aria-label],[title],[placeholder]"))
        for (const a of ["aria-label", "title", "placeholder"]) if (el.getAttribute(a)) out.push(el.getAttribute(a)!);
      return out;
    });
    for (const t of texts) if (FR.test(t)) found.push(`${where} : ${t}`);
  };
  await scan("arbre");
  await page.locator('.cr-node[data-kind="sample"]').first().click({ button: "right" });
  await scan("menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  for (const tab of ["Sources", "Appearance", "Playback", "Search"]) {
    await page.getByRole("radio", { name: tab, exact: true }).click();
    await scan(`réglages ${tab}`);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+F");
  await scan("mode grand");
  await page.keyboard.press("Control+2");
  await scan("Virtual");
  expect(found).toEqual([]);
});
