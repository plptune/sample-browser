// Tags automatiques : vocabulaire fermé posé par l'analyse (miroir de `crates/crate-core/src/autotag.rs`).

/** Instruments (batterie d'abord) puis espace. */
export const AUTO_VOCABULARY = [
  "kick", "snare", "clap", "rim", "snap", "hat", "openhat", "cymbal", "tom", "shaker", "perc",
  "fx", "808", "sub", "bass", "pad", "lead", "piano", "keys", "string", "brass", "vocal", "synth",
  "wet", "dry",
] as const;

/** Tags dérivés du type du sample : affichés comme des tags, jamais stockés. */
export const KIND_TAGS = ["loop", "oneshot"] as const;

export const isKindTag = (tag: string) => (KIND_TAGS as readonly string[]).includes(tag);

export const isVocabulary = (tag: string) => (AUTO_VOCABULARY as readonly string[]).includes(tag);

/** Tag tapé : sans espaces autour, en minuscules ; `null` s'il est vide ou réservé (`loop` / `oneshot`). */
export function normalizeTag(tag: string): string | null {
  const t = tag.trim().toLowerCase();
  return t && !(KIND_TAGS as readonly string[]).includes(t) ? t : null;
}
