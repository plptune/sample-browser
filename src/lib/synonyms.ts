// Synonymes de recherche : un mot libre qui appartient à un groupe trouve aussi les autres mots du groupe
// (`kick` trouve aussi `bd`). Miroir de crates/crate-core/src/synonyms.rs.

/** Groupes proposés au premier lancement (modifiables dans les Réglages). */
export const DEFAULT_SYNONYMS: string[][] = [
  ["kick", "bd", "bassdrum"],
  ["snare", "sd"],
  ["hat", "hh", "hihat"],
  ["clap", "cp"],
  ["perc", "percussion"],
  ["vox", "vocal"],
  ["fx", "sfx"],
];

/** Minuscules, sans espaces autour, sans doublons ; un groupe de moins de deux mots est ignoré. */
export function normalizeSynonyms(groups: string[][]): string[][] {
  return groups
    .map((g) => {
      const out: string[] = [];
      for (const w of g.map((x) => x.trim().toLowerCase())) if (w && !out.includes(w)) out.push(w);
      return out;
    })
    .filter((g) => g.length >= 2);
}

/** Mots équivalents à `word` (lui compris), ou null s'il n'est dans aucun groupe. */
export function expandSynonym(groups: string[][], word: string): string[] | null {
  const w = word.toLowerCase();
  const out: string[] = [];
  for (const g of groups) if (g.includes(w)) for (const x of g) if (!out.includes(x)) out.push(x);
  return out.length ? out : null;
}
