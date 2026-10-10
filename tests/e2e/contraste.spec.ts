// Contraste du texte (WCAG 2.1) : ≥ 4,5:1 pour le texte des lignes de l'arbre, sélectionnées ou non, du tiroir et de
// l'inspecteur. Couleurs lues telles que rendues (les color-mix des tokens compris), dans les deux thèmes, en colonne
// et en grand, liste avec ou sans focus. Un échec liste chaque texte trop pâle avec son rapport.
import { expect, test, type Page } from "@playwright/test";

const MIN = 4.5;

/** Rapport de contraste de chaque élément texte visible sous `scope` (fond : premier ancêtre opaque). */
async function contrasts(page: Page, scope: string, items: string) {
  return page.evaluate(
    ({ scope, items }) => {
      const parse = (c: string): number[] | null => {
        // rgb(r, g, b[, a]) ou color(srgb r g b[ / a]) (résultat d'un color-mix).
        const rgb = c.match(/^rgba?\(([^)]+)\)$/);
        if (rgb) {
          const [r, g, b, a = "1"] = rgb[1].split(/[ ,/]+/).filter(Boolean);
          return [+r / 255, +g / 255, +b / 255, +a];
        }
        const srgb = c.match(/^color\(srgb ([^)]+)\)$/);
        if (srgb) {
          const [r, g, b, a = "1"] = srgb[1].split(/[ /]+/).filter(Boolean);
          return [+r, +g, +b, +a];
        }
        return null;
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
      /** Fond effectif : on empile les fonds (semi-transparents compris) jusqu'au premier opaque. */
      const background = (el: Element) => {
        const layers: number[][] = [];
        for (let e: Element | null = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c[3] > 0) {
            layers.push(c);
            if (c[3] >= 1) break;
          }
        }
        return layers.reduceRight((acc, c) => over(c, acc), [1, 1, 1, 1]);
      };
      const out: { text: string; ratio: number; color: string }[] = [];
      for (const root of document.querySelectorAll(scope)) {
        for (const el of root.querySelectorAll<HTMLElement>(items)) {
          const text = el.textContent?.trim();
          if (!text || !el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
          const fg = parse(getComputedStyle(el).color);
          if (!fg) continue;
          const bg = background(el);
          const [a, b] = [lum(over(fg, bg)), lum(bg)].sort((x, y) => y - x);
          out.push({ text: text.slice(0, 40), ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, color: getComputedStyle(el).color });
        }
      }
      return out;
    },
    { scope, items },
  );
}

const ROW_TEXT = ".cr-node__label, .cr-node__meta, .cr-col-tags";

for (const theme of ["dark", "light"] as const) {
  for (const layout of ["side", "full"] as const) {
    test(`contraste ${theme === "dark" ? "sombre" : "clair"}, ${layout === "side" ? "colonne" : "grand"}`, async ({ page }) => {
      await page.setViewportSize({ width: 1300, height: 900 });
      await page.goto("/");
      await page.locator("body").click({ position: { x: 5, y: 880 } });
      await page.keyboard.press("3"); // Navigation : kicks ouverts, un kick sélectionné
      await expect(page.locator(".cr-node[data-selected]")).toHaveCount(1);
      if (theme === "light") await page.getByRole("button", { name: "Light" }).first().click();
      if (layout === "full") await page.keyboard.press("Control+Shift+F");
      await expect(page.locator(`[data-theme=${theme}] .cr-panel[data-layout=${layout}]`)).toBeVisible();

      const failures: string[] = [];
      const check = async (what: string, scope: string, items: string) => {
        const res = await contrasts(page, scope, items);
        expect(res.length, `${what} : aucun texte trouvé`).toBeGreaterThan(0);
        for (const r of res) if (r.ratio < MIN) failures.push(`${what} « ${r.text} » ${r.ratio}:1 (${r.color})`);
      };

      // Liste sans focus, puis avec focus (la sélection change de teinte).
      await page.locator("body").click({ position: { x: 5, y: 880 } });
      await check("ligne sélectionnée", ".cr-node[data-selected]", ROW_TEXT);
      await page.locator(".cr-tree").focus();
      await check("ligne sélectionnée (focus)", ".cr-node[data-selected]", ROW_TEXT);
      await check("lignes", ".cr-node:not([data-selected])", ROW_TEXT);
      if (layout === "side") {
        await check("tiroir", ".cr-drawer", ".cr-drawer__title, .cr-drawer__time, .cr-drawer__label, .cr-tag");
      } else {
        await check("inspecteur", ".cr-inspector", ".cr-inspector__name, dd, .cr-tag");
      }
      expect(failures).toEqual([]);
    });
  }
}
