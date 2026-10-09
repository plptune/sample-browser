// Backend factice (phase 0). Filtre naïf en JS sur les mocks, juste pour l'illusion.
// Remplacé en phase 1 par src/api/tauri.ts (invoke) — l'UI ne change pas.

import { parseLine, type QueryToken } from "../lib/query";
import { COLLECTIONS, COLLECTION_ITEMS, RECENT_IDS, SAMPLES, SOURCES, TAGS, isInFolder } from "../mock/generate";
import type { Backend, Library, Sample, Scope, SearchPage, SearchRequest, SortKey } from "./types";

const NOTE_ORDER = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function parseRange(v: string, unit = ""): (n: number) => boolean {
  const s = v.replace(unit, "");
  const num = (x: string) => parseFloat(x.replace(unit, ""));
  if (s.startsWith(">=")) return (n) => n >= num(s.slice(2));
  if (s.startsWith("<=")) return (n) => n <= num(s.slice(2));
  if (s.startsWith(">")) return (n) => n > num(s.slice(1));
  if (s.startsWith("<")) return (n) => n < num(s.slice(1));
  if (s.includes("-")) {
    const [a, b] = s.split("-").map(num);
    return (n) => n >= a && n <= b;
  }
  const x = num(s);
  return (n) => Math.round(n) === Math.round(x);
}

function matchToken(s: Sample, t: QueryToken): boolean {
  switch (t.kind) {
    case "text":
    case "phrase": {
      const hay = `${s.name} ${s.path} ${s.tags.join(" ")}`.toLowerCase();
      return hay.includes(t.value.toLowerCase());
    }
    case "tag":
      return s.tags.includes(t.value);
    case "filter":
      switch (t.key) {
        case "bpm":
          return s.bpm !== null && parseRange(t.value)(s.bpm);
        case "dur":
          return parseRange(t.value, "s")(s.durationMs / 1000);
        case "key": {
          if (!s.key) return false;
          const want = t.value.toLowerCase();
          const have = s.key.toLowerCase();
          // note seule = majeur + mineur
          return have === want || (!want.endsWith("m") && have.replace(/m$/, "") === want);
        }
        case "type":
          return s.kind === (t.value === "one-shot" ? "oneshot" : t.value);
        case "is":
          if (t.value === "fav") return s.fav;
          if (t.value === "untagged") return s.tags.length === 0;
          return false;
        case "in": {
          const v = t.value.toLowerCase();
          const c = COLLECTIONS.find((c) => c.name.toLowerCase().startsWith(v));
          if (c) return inScope(s, { type: "collection", id: c.id });
          return s.path.toLowerCase().includes(v);
        }
      }
  }
}

function matchLine(s: Sample, line: string): boolean {
  return parseLine(line).every((t) => matchToken(s, t) !== t.negated);
}

function inScope(s: Sample, scope: Scope): boolean {
  switch (scope.type) {
    case "all":
      return true;
    case "fav":
      return s.fav;
    case "untagged":
      return s.tags.length === 0;
    case "recent":
      return RECENT_IDS.includes(s.id);
    case "folder":
      return isInFolder(s.folderId, scope.id);
    case "collection": {
      const c = COLLECTIONS.find((c) => c.id === scope.id);
      if (!c) return false;
      if (c.kind === "smart") return matchLine(s, c.query ?? "");
      return COLLECTION_ITEMS[c.id]?.includes(s.id) ?? false;
    }
  }
}

const keyIndex = (k: string | null) => (k ? NOTE_ORDER.indexOf(k.replace(/m$/, "")) * 2 + (k.endsWith("m") ? 1 : 0) : 999);

const SORTERS: Record<SortKey, (a: Sample, b: Sample) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, "en", { numeric: true }),
  bpm: (a, b) => (a.bpm ?? 999) - (b.bpm ?? 999),
  key: (a, b) => keyIndex(a.key) - keyIndex(b.key),
  dur: (a, b) => a.durationMs - b.durationMs,
};

const byId = new Map(SAMPLES.map((s) => [s.id, s]));

export const mockBackend: Backend = {
  async library(): Promise<Library> {
    const tags = TAGS.map((name) => ({ name, count: SAMPLES.filter((s) => s.tags.includes(name)).length })).sort(
      (a, b) => b.count - a.count,
    );
    return {
      total: SAMPLES.length,
      favCount: SAMPLES.filter((s) => s.fav).length,
      untaggedCount: SAMPLES.filter((s) => s.tags.length === 0).length,
      recentCount: RECENT_IDS.length,
      tags,
      collections: COLLECTIONS.map((c) => ({
        ...c,
        count: SAMPLES.filter((s) => inScope(s, { type: "collection", id: c.id })).length,
      })),
      sources: SOURCES,
    };
  },

  async search(req: SearchRequest): Promise<SearchPage> {
    const all = SAMPLES.filter((s) => inScope(s, req.scope) && matchLine(s, req.query)).sort(SORTERS[req.sort]);
    // copies : l'UI reçoit des valeurs, comme à travers l'IPC Tauri
    return { items: all.slice(req.offset, req.offset + req.limit).map((s) => ({ ...s })), total: all.length };
  },

  async setFavorite(ids, fav) {
    for (const id of ids) {
      const s = byId.get(id);
      if (s) s.fav = fav;
    }
  },

  async addTag(ids, tag) {
    for (const id of ids) {
      const s = byId.get(id);
      if (s && !s.tags.includes(tag)) s.tags = [...s.tags, tag].sort();
    }
  },

  async removeTag(ids, tag) {
    for (const id of ids) {
      const s = byId.get(id);
      if (s) s.tags = s.tags.filter((t) => t !== tag);
    }
  },

  async renameCollection(id, name) {
    const c = COLLECTIONS.find((c) => c.id === id);
    if (c) c.name = name;
  },
};

/** Réservé aux scénarios de démo : marque des fichiers comme introuvables. */
export function mockSetMissing(ids: number[]) {
  for (const s of SAMPLES) s.missing = ids.includes(s.id);
}
