// Découpage de la ligne de recherche en tokens.
// Sert à l'UI (chips) et, en phase 0 seulement, au filtre naïf des mocks.
// En phase 3 le vrai parser vit en Rust ; l'UI garde ce module pour l'affichage des chips.

export const FILTER_KEYS = ["bpm", "key", "dur", "in", "type", "is"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type QueryToken =
  | { kind: "text"; raw: string; value: string; negated: boolean }
  | { kind: "phrase"; raw: string; value: string; negated: boolean }
  | { kind: "tag"; raw: string; value: string; negated: boolean }
  | { kind: "filter"; raw: string; key: FilterKey; value: string; negated: boolean };

/** Découpe sur les espaces en respectant les "phrases". */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  const re = /-?"[^"]*"?|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[0]);
  return out;
}

export function parseToken(raw: string): QueryToken {
  let body = raw;
  let negated = false;
  if (body.length > 1 && body.startsWith("-")) {
    negated = true;
    body = body.slice(1);
  }
  if (body.startsWith('"')) {
    return { kind: "phrase", raw, value: body.replace(/"/g, ""), negated };
  }
  if (body.startsWith("#") && body.length > 1) {
    return { kind: "tag", raw, value: body.slice(1).toLowerCase(), negated };
  }
  const colon = body.indexOf(":");
  if (colon > 0) {
    const key = body.slice(0, colon).toLowerCase();
    const value = body.slice(colon + 1);
    if ((FILTER_KEYS as readonly string[]).includes(key) && value) {
      return { kind: "filter", raw, key: key as FilterKey, value, negated };
    }
  }
  return { kind: "text", raw, value: body.toLowerCase(), negated };
}

/** Un token devient une chip s'il n'est pas un simple mot libre. */
export function isChip(raw: string): boolean {
  const t = parseToken(raw);
  return t.kind !== "text" || t.negated;
}

export function parseLine(line: string): QueryToken[] {
  return splitLine(line).map(parseToken);
}

/** Libellé court d'une chip : clé + valeur séparées pour le rendu. */
export function chipParts(raw: string): { key?: string; value: string; exclude: boolean } {
  const t = parseToken(raw);
  if (t.kind === "filter") return { key: t.key, value: t.value, exclude: t.negated };
  if (t.kind === "tag") return { value: `#${t.value}`, exclude: t.negated };
  if (t.kind === "phrase") return { value: `“${t.value}”`, exclude: t.negated };
  return { value: t.value, exclude: t.negated };
}
