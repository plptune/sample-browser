// Données factices déterministes (graine fixe) : mêmes samples à chaque chargement,
// pour des captures stables. Aucun aléa au rendu.

import type { Collection, FolderNode, Sample, SampleKind } from "../api/types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xc4a7e);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

export const TAGS = [
  "warm", "dark", "bright", "punchy", "lofi", "vinyl",
  "airy", "gritty", "clean", "analog", "tape", "wide",
] as const;

const KEYS = ["C", "Cm", "D", "Dm", "E", "Em", "F", "Fm", "F#m", "G", "Gm", "A", "Am", "Bb", "Bm"];
const ADJ = ["Dusty", "Warm", "Punchy", "Lofi", "Tape", "Deep", "Bright", "Crunchy", "Vinyl", "Soft", "Hard", "Analog", "Dark", "Airy", "Round"];

// ---------- Arborescence des sources (3 niveaux) ----------

export const SOURCES: FolderNode[] = [
  {
    id: 1, name: "Splice", count: 0, children: [
      {
        id: 2, name: "packs", count: 0, children: [
          { id: 3, name: "Dusty Tapes Vol.2", count: 0, children: [] },
          { id: 4, name: "Night Textures", count: 0, children: [] },
          { id: 5, name: "Lofi Keys", count: 0, children: [] },
        ],
      },
    ],
  },
  {
    id: 10, name: "Samples", count: 0, children: [
      {
        id: 11, name: "Drums", count: 0, children: [
          { id: 12, name: "Kicks", count: 0, children: [] },
          { id: 13, name: "Snares", count: 0, children: [] },
          { id: 14, name: "Hats", count: 0, children: [] },
          { id: 15, name: "Perc", count: 0, children: [] },
        ],
      },
      { id: 16, name: "Bass", count: 0, children: [] },
      {
        id: 17, name: "Vocals", count: 0, children: [
          { id: 18, name: "Chops", count: 0, children: [] },
        ],
      },
    ],
  },
  {
    id: 20, name: "Field Recordings", count: 0, offline: true, children: [
      {
        id: 21, name: "Paris", count: 0, children: [
          { id: 22, name: "Metro", count: 0, children: [] },
        ],
      },
      { id: 23, name: "Forest", count: 0, children: [] },
    ],
  },
];

const ROOT_PATHS: Record<number, string> = {
  1: "~/Splice/sounds",
  10: "~/Music/Samples",
  20: "/Volumes/Field SSD",
};

// parent de chaque nœud + chemin complet
const parentOf = new Map<number, number | null>();
const pathOf = new Map<number, string>();
(function walk(nodes: FolderNode[], parent: number | null, base: string) {
  for (const n of nodes) {
    parentOf.set(n.id, parent);
    const p = parent === null ? ROOT_PATHS[n.id] : `${base}/${n.name}`;
    pathOf.set(n.id, p);
    walk(n.children, n.id, p);
  }
})(SOURCES, null, "");

/** Vrai si `folderId` est `ancestor` ou l'un de ses descendants. */
export function isInFolder(folderId: number, ancestor: number): boolean {
  let cur: number | null | undefined = folderId;
  while (cur != null) {
    if (cur === ancestor) return true;
    cur = parentOf.get(cur);
  }
  return false;
}

// ---------- Catégories de samples ----------

interface Category {
  name: string;
  kind: SampleKind;
  folders: number[];
  count: number;
  dur?: [number, number]; // ms, pour les one-shots
  bars?: number[]; // pour les loops
  bpm?: [number, number];
  keyed?: boolean;
  tags: readonly string[];
  shape: "hit" | "loop" | "swell" | "noise";
}

const CATEGORIES: Category[] = [
  { name: "Kick", kind: "oneshot", folders: [12, 12, 3], count: 46, dur: [180, 720], tags: ["punchy", "dark", "warm", "tape", "analog", "clean"], shape: "hit" },
  { name: "Snare", kind: "oneshot", folders: [13, 13, 3], count: 38, dur: [140, 520], tags: ["punchy", "bright", "gritty", "vinyl", "tape"], shape: "hit" },
  { name: "Clap", kind: "oneshot", folders: [13, 3], count: 20, dur: [150, 450], tags: ["bright", "wide", "clean", "lofi"], shape: "hit" },
  { name: "HiHat", kind: "oneshot", folders: [14, 14, 3], count: 34, dur: [50, 260], tags: ["bright", "airy", "clean", "gritty"], shape: "hit" },
  { name: "OpenHat", kind: "oneshot", folders: [14], count: 14, dur: [300, 900], tags: ["bright", "airy", "vinyl"], shape: "hit" },
  { name: "Perc", kind: "oneshot", folders: [15, 15, 3], count: 30, dur: [80, 600], tags: ["warm", "lofi", "analog", "dark"], shape: "hit" },
  { name: "Drum_Loop", kind: "loop", folders: [3, 3, 11], count: 36, bars: [1, 2, 4], bpm: [84, 140], tags: ["lofi", "tape", "vinyl", "punchy", "gritty"], shape: "loop" },
  { name: "Top_Loop", kind: "loop", folders: [3, 14], count: 18, bars: [1, 2], bpm: [90, 130], tags: ["airy", "bright", "lofi"], shape: "loop" },
  { name: "Bass", kind: "oneshot", folders: [16], count: 26, dur: [400, 2200], keyed: true, tags: ["dark", "warm", "analog", "gritty"], shape: "hit" },
  { name: "Bass_Loop", kind: "loop", folders: [16], count: 18, bars: [2, 4], bpm: [80, 128], keyed: true, tags: ["dark", "warm", "analog"], shape: "loop" },
  { name: "Keys_Loop", kind: "loop", folders: [5, 5], count: 28, bars: [4, 8], bpm: [70, 96], keyed: true, tags: ["lofi", "warm", "vinyl", "tape"], shape: "swell" },
  { name: "Pad", kind: "oneshot", folders: [4, 4, 5], count: 22, dur: [3000, 9000], keyed: true, tags: ["airy", "wide", "dark", "warm"], shape: "swell" },
  { name: "Texture", kind: "oneshot", folders: [4, 4, 23], count: 20, dur: [4000, 14000], tags: ["dark", "wide", "airy", "gritty"], shape: "noise" },
  { name: "Vox_Chop", kind: "oneshot", folders: [18], count: 24, dur: [200, 1400], keyed: true, tags: ["airy", "bright", "lofi", "wide"], shape: "hit" },
  { name: "Riser", kind: "oneshot", folders: [4], count: 10, dur: [2000, 6000], tags: ["bright", "wide"], shape: "swell" },
  { name: "Ambience", kind: "oneshot", folders: [22, 23], count: 16, dur: [12000, 40000], tags: ["wide", "dark", "airy"], shape: "noise" },
];

function peaksFor(shape: Category["shape"], beats: number): number[] {
  const n = 256;
  const out: number[] = new Array(n);
  const attack = between(2, 8);
  const decay = between(3, 14);
  const swellAt = between(0.35, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let env: number;
    switch (shape) {
      case "hit":
        env = i < attack ? i / attack : Math.exp(-(i - attack) / (decay * 4));
        break;
      case "loop": {
        const pos = (t * beats * 2) % 1; // croches
        const strong = Math.floor(t * beats * 2) % 2 === 0;
        env = Math.exp(-pos * 7) * (strong ? 1 : 0.55) + 0.08;
        break;
      }
      case "swell":
        env = t < swellAt ? Math.pow(t / swellAt, 1.6) : 1 - Math.pow((t - swellAt) / (1 - swellAt), 2) * 0.85;
        break;
      case "noise":
        env = 0.45 + 0.25 * Math.sin(t * 9 + beats) + 0.15 * Math.sin(t * 23);
        break;
    }
    out[i] = Math.max(0.02, Math.min(1, env * (0.7 + 0.3 * rand())));
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function makeSamples(): Sample[] {
  const samples: Sample[] = [];
  let id = 1;
  for (const cat of CATEGORIES) {
    for (let i = 1; i <= cat.count; i++) {
      const folderId = pick(cat.folders);
      const adj = pick(ADJ);
      const key = cat.keyed ? pick(KEYS) : null;
      let bpm: number | null = null;
      let durationMs: number;
      let beats = 4;
      let name: string;
      if (cat.kind === "loop") {
        bpm = int(cat.bpm![0], cat.bpm![1]);
        const bars = pick(cat.bars!);
        beats = bars * 4;
        durationMs = Math.round((beats * 60000) / bpm);
        name = key ? `${cat.name}_${adj}_${bpm}_${key}` : `${cat.name}_${adj}_${bpm}`;
      } else {
        durationMs = Math.round(between(cat.dur![0], cat.dur![1]));
        name = key ? `${cat.name}_${adj}_${key}_${pad2(i)}` : `${cat.name}_${adj}_${pad2(i)}`;
      }
      const tagCount = rand() < 0.14 ? 0 : Math.min(int(1, 3), cat.tags.length);
      const tags = new Set<string>();
      while (tags.size < tagCount) tags.add(pick(cat.tags));
      if (adj.toLowerCase() !== "deep" && (TAGS as readonly string[]).includes(adj.toLowerCase()) && tagCount > 0) {
        tags.add(adj.toLowerCase());
      }
      const ext = rand() < 0.85 ? "wav" : "aif";
      samples.push({
        id: id++,
        name,
        ext,
        path: `${pathOf.get(folderId)}/${name}.${ext}`,
        folderId,
        durationMs,
        sampleRate: rand() < 0.75 ? 44100 : 48000,
        bitDepth: rand() < 0.6 ? 24 : 16,
        channels: cat.shape === "hit" && rand() < 0.6 ? 1 : 2,
        bpm,
        key,
        kind: cat.kind,
        tags: [...tags].sort(),
        fav: rand() < 0.08,
        missing: false,
        peaks: peaksFor(cat.shape, beats),
      });
    }
  }
  return samples;
}

export const SAMPLES: Sample[] = makeSamples();

// Nombre de samples par dossier (cumulé vers les parents).
(function count(nodes: FolderNode[]): void {
  for (const n of nodes) {
    count(n.children);
    n.count = SAMPLES.filter((s) => isInFolder(s.folderId, n.id)).length;
  }
})(SOURCES);

// ---------- Collections ----------

const byPrefix = (p: string, n: number, step = 1) =>
  SAMPLES.filter((s) => s.name.startsWith(p)).filter((_, i) => i % step === 0).slice(0, n).map((s) => s.id);

export const COLLECTION_ITEMS: Record<number, number[]> = {
  1: [...byPrefix("Keys_Loop", 6, 3), ...byPrefix("Pad", 4, 4), ...byPrefix("Bass_Loop", 3, 5), ...byPrefix("Drum_Loop", 5, 6)],
  2: byPrefix("Kick", 12, 3),
  3: [...byPrefix("Texture", 10, 2), ...byPrefix("Ambience", 4, 3)],
  4: byPrefix("Vox_Chop", 14, 1),
};

export const COLLECTIONS: Omit<Collection, "count">[] = [
  { id: 1, name: "Night Drive", kind: "manual" },
  { id: 2, name: "Go-to kicks", kind: "manual" },
  { id: 3, name: "Textures", kind: "manual" },
  { id: 4, name: "Vocal chops", kind: "manual" },
  { id: 5, name: "Loops en Am", kind: "smart", query: "type:loop key:Am" },
  { id: 6, name: "Courts & sombres", kind: "smart", query: "#dark dur:<1s" },
];

// « Récents » : sous-ensemble fixe
export const RECENT_IDS = SAMPLES.filter((s) => s.id % 17 === 3).map((s) => s.id);
