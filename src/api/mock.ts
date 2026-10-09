// Backend factice (phase 0). Filtre naïf en JS sur les mocks, juste pour l'illusion.
// Remplacé en phase 1 par src/api/tauri.ts (invoke) — l'UI ne change pas.

import { naturalCompare } from "../lib/natural";
import { parseLine, type QueryToken } from "../lib/query";
import { COLLECTIONS, COLLECTION_ITEMS, ROOT_PATHS, SAMPLES, SOURCES, TAGS, type FolderNode } from "../mock/generate";
import type { Backend, Collection, FolderRow, Library, NodeKey, NodeKind, Sample, TreePage, TreeRequest, TreeRow } from "./types";

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
          return t.value === "untagged" ? s.tags.length === 0 : false;
        case "in": {
          const v = t.value.toLowerCase();
          const c = COLLECTIONS.find((c) => c.name.toLowerCase().startsWith(v));
          if (c) return collectionSamples(c.id).includes(s);
          return s.path.toLowerCase().includes(v);
        }
      }
  }
}

function matchLine(s: Sample, line: string): boolean {
  return parseLine(line).every((t) => matchToken(s, t) !== t.negated);
}

// ---------- Arbre ----------

const folders = new Map<number, FolderNode>();
(function index(nodes: FolderNode[]) {
  for (const n of nodes) {
    folders.set(n.id, n);
    index(n.children);
  }
})(SOURCES);

// Même ordre que le cœur Rust (crate-core/src/natural.rs), indépendant de la locale.
const byName = (a: Sample, b: Sample) => naturalCompare(a.name, b.name);

function collectionSamples(id: number): Sample[] {
  const c = COLLECTIONS.find((c) => c.id === id);
  if (!c) return [];
  if (c.kind === "smart") return SAMPLES.filter((s) => matchLine(s, c.query ?? ""));
  const ids = COLLECTION_ITEMS[c.id] ?? [];
  return SAMPLES.filter((s) => ids.includes(s.id));
}

interface NodeInfo {
  key: NodeKey;
  name: string;
  kind: NodeKind;
  offline?: boolean;
}

function childNodes(key: NodeKey | null): NodeInfo[] {
  const folderInfo = (f: FolderNode): NodeInfo => ({ key: `f:${f.id}`, name: f.name, kind: "folder", offline: f.offline });
  if (key === null) return [...SOURCES.map(folderInfo), { key: "g:collections", name: "Collections", kind: "group" }];
  if (key === "g:collections")
    return [
      { key: "c:fav", name: "Favoris", kind: "favorites" },
      ...COLLECTIONS.map((c): NodeInfo => ({ key: `c:${c.id}`, name: c.name, kind: c.kind === "smart" ? "smart" : "collection" })),
    ];
  if (key.startsWith("f:")) return folders.get(+key.slice(2))?.children.map(folderInfo) ?? [];
  return [];
}

function childSamples(key: NodeKey): Sample[] {
  if (key.startsWith("f:")) {
    const id = +key.slice(2);
    return SAMPLES.filter((s) => s.folderId === id).sort(byName);
  }
  if (key === "c:fav") return SAMPLES.filter((s) => s.fav).sort(byName);
  if (key.startsWith("c:")) return collectionSamples(+key.slice(2)).sort(byName);
  return [];
}

const byId = new Map(SAMPLES.map((s) => [s.id, s]));

export const mockBackend: Backend = {
  async library(): Promise<Library> {
    const names = [...new Set<string>([...TAGS, ...SAMPLES.flatMap((s) => s.tags)])];
    const tags = names.map((name) => ({ name, count: SAMPLES.filter((s) => s.tags.includes(name)).length })).sort(
      (a, b) => b.count - a.count,
    );
    return { total: SAMPLES.length, tags, collections: COLLECTIONS.map((c) => ({ ...c })) };
  },

  async tree(req: TreeRequest): Promise<TreePage> {
    const q = req.query.trim();
    const searching = q !== "";
    const match = (s: Sample) => !searching || matchLine(s, q);

    // Un nœud reste visible en recherche s'il contient au moins un résultat (mémoïsé par requête).
    const memo = new Map<NodeKey, boolean>();
    const hasMatch = (key: NodeKey): boolean => {
      if (!memo.has(key)) memo.set(key, childSamples(key).some(match) || childNodes(key).some((n) => hasMatch(n.key)));
      return memo.get(key)!;
    };

    const rows: TreeRow[] = [];
    const walk = (key: NodeKey | null, depth: number) => {
      for (const n of childNodes(key)) {
        // En recherche : on masque les collections (doublons) et les dossiers sans résultat.
        if (searching && (n.kind === "group" || !hasMatch(n.key))) continue;
        const open = searching || req.expanded.includes(n.key);
        const row: FolderRow = { type: "node", key: n.key, parent: key, depth, name: n.name, kind: n.kind, open };
        if (n.offline) row.offline = true;
        rows.push(row);
        if (open) walk(n.key, depth + 1);
      }
      if (key === null) return;
      for (const s of childSamples(key)) {
        if (!match(s)) continue;
        // copies : l'UI reçoit des valeurs, comme à travers l'IPC Tauri
        rows.push({ type: "sample", key: `s:${s.id}@${key}`, parent: key, depth, sample: { ...s } });
      }
    };
    walk(null, 0);

    return {
      rows: rows.slice(req.offset, req.offset + req.limit),
      totalRows: rows.length,
      matches: searching ? SAMPLES.filter(match).length : SAMPLES.length,
    };
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

  async sources() {
    return SOURCES.map((f) => ({ id: f.id, name: f.name, path: ROOT_PATHS[f.id], offline: !!f.offline }));
  },

  async createCollection(name, query) {
    const c: Collection = { id: Math.max(0, ...COLLECTIONS.map((c) => c.id)) + 1, name, kind: query ? "smart" : "manual", query };
    COLLECTIONS.push(c);
    if (!query) COLLECTION_ITEMS[c.id] = [];
    return { ...c };
  },

  async renameCollection(id, name) {
    const c = COLLECTIONS.find((c) => c.id === id);
    if (c) c.name = name;
  },

  async deleteCollection(id) {
    const i = COLLECTIONS.findIndex((c) => c.id === id);
    if (i >= 0) COLLECTIONS.splice(i, 1);
  },

  async addToCollection(id, ids) {
    const items = (COLLECTION_ITEMS[id] ??= []);
    for (const s of ids) if (!items.includes(s)) items.push(s);
  },

  async removeSource(id) {
    const i = SOURCES.findIndex((f) => f.id === id);
    if (i >= 0) SOURCES.splice(i, 1);
  },

  async revealInFinder() {
    // Phase 0 : rien. Phase 1 : commande Rust (opener).
  },
};

/** Réservé aux scénarios de démo : marque des fichiers comme introuvables. */
export function mockSetMissing(ids: number[]) {
  for (const s of SAMPLES) s.missing = ids.includes(s.id);
}
