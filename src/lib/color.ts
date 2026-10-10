// Couleurs choisies dans les Réglages → variables CSS du design system.
import type { ColorOverrides, ColorRole } from "../state/app";

const VARS: Record<ColorRole, string> = { accent: "--cr-accent", bg: "--cr-bg" };

/** Luminance relative (WCAG) d'une couleur #rrggbb. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texte lisible sur une couleur : quasi-noir sur clair, blanc sur foncé. */
export const onColor = (hex: string) => (luminance(hex) > 0.4 ? "#1b1b1b" : "#ffffff");

/** Variables CSS à poser pour les couleurs modifiées d'un thème (vide = celles du design system). */
export function colorVars(c: NonNullable<ColorOverrides["dark"]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of Object.keys(VARS) as ColorRole[]) {
    const v = c[role];
    if (v) out[VARS[role]] = v;
  }
  if (c.accent) out["--cr-on-accent"] = onColor(c.accent);
  return out;
}

/** Toutes les variables qu'un réglage de couleur peut poser (pour les retirer). */
export const COLOR_VARS = [...Object.values(VARS), "--cr-on-accent"];

/** Couleurs de base du design system (mêmes valeurs que tokens.css), montrées tant qu'on ne les a pas changées. */
export const DEFAULT_COLORS: Record<"dark" | "light", Record<ColorRole, string>> = {
  dark: { accent: "#e8a33d", bg: "#232323" },
  light: { accent: "#c67a12", bg: "#e4e4e4" },
};
