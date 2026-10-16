// Tonalités écrites (« Am », « C# », « Bbmin », « F#m », « Eb major ») : même lecture que
// crates/crate-core/src/analysis.rs (parse_key), pour que key:A# trouve Bb des deux côtés.

const BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `key:minor` → true, `key:major` → false, sinon null (une tonalité écrite). */
export function modeOnly(want: string): boolean | null {
  const w = want.trim().toLowerCase();
  return w === "minor" || w === "min" ? true : w === "major" || w === "maj" ? false : null;
}

/** [classe de hauteur, mineur, mode écrit] ou null. */
function parse(s: string): [number, boolean, boolean] | null {
  const t = s.trim();
  const base = BASE[t.charAt(0).toUpperCase()];
  if (base === undefined) return null;
  let rest = t.slice(1);
  let shift = 0;
  if (rest.startsWith("#") || rest.startsWith("♯")) [shift, rest] = [1, rest.slice(1)];
  else if (rest.startsWith("♭")) [shift, rest] = [-1, rest.slice(1)];
  else if (rest.startsWith("b") && !rest.startsWith("bpm")) [shift, rest] = [-1, rest.slice(1)];
  const mode = rest.trim().toLowerCase();
  let minor: boolean;
  if (["", "maj", "major", "dur"].includes(mode)) minor = false;
  else if (["m", "min", "minor", "moll", "mi"].includes(mode)) minor = true;
  else return null;
  return [(((base + shift) % 12) + 12) % 12, minor, mode !== ""];
}

/** Tonalité lisible : « Am » → « A minor », « F# » → « F♯ major », « Bbm » → « B♭ minor » (l'écriture de la note est
 *  gardée) ; une valeur illisible est rendue telle quelle. */
export function formatKey(s: string): string {
  const p = parse(s);
  if (!p) return s;
  const t = s.trim();
  const acc = /^.[#♯]/.test(t) ? "♯" : /^.(♭|b(?!pm))/.test(t) ? "♭" : "";
  return `${t.charAt(0).toUpperCase()}${acc} ${p[1] ? "minor" : "major"}`;
}

/** `key:` — une note seule couvre majeur et mineur ; les enharmonies se valent (A# = Bb) ; `key:minor` /
 *  `key:major` (ou `min` / `maj`) : le mode seul, quelle que soit la tonique. */
export function keyMatches(have: string, want: string): boolean {
  const mode = modeOnly(want);
  if (mode !== null) return parse(have)?.[1] === mode;
  const h = parse(have);
  const w = parse(want);
  if (!h || !w) return false;
  return h[0] === w[0] && (!w[2] || h[1] === w[1]);
}

/** Rang d'une tonalité pour le tri de la liste : classe de hauteur (do d'abord), majeur avant mineur ; null si
 *  illisible. Même rang que `key_rank` (crates/crate-core/src/catalog.rs). */
export function keyRank(key: string | null | undefined): number | null {
  const k = key ? parse(key) : null;
  return k ? k[0] * 2 + (k[1] ? 1 : 0) : null;
}
