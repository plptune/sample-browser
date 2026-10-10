// Tonalités écrites (« Am », « C# », « Bbmin », « F#m », « Eb major ») : même lecture que
// crates/crate-core/src/analysis.rs (parse_key), pour que key:A# trouve Bb des deux côtés.

const BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

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

/** `key:` — une note seule couvre majeur et mineur ; les enharmonies se valent (A# = Bb). */
export function keyMatches(have: string, want: string): boolean {
  const h = parse(have);
  const w = parse(want);
  if (!h || !w) return false;
  return h[0] === w[0] && (!w[2] || h[1] === w[1]);
}
