// Backend factice : navigateur, Storybook et prototype en ligne. Filtre naïf en JS sur les mocks.
// La fenêtre Tauri utilise src/api/tauri.ts ; crates/crate-core/src/mock en est le port Rust exact (test de parité).

import { naturalCompare } from "../lib/natural";
import { parseLine, type QueryToken } from "../lib/query";
import { DEFAULT_SYNONYMS, expandSynonym, normalizeSynonyms } from "../lib/synonyms";
import {
  COLLECTIONS, COLLECTION_ITEMS, FAVORITES, PINNED_FOLDERS, ROOT_PATHS, SAMPLES, SOURCES, TAGS, VIRTUAL_FOLDERS, VIRTUAL_ITEMS,
  type FolderNode,
} from "../mock/generate";
import type {
  Backend, Collection, CommitOptions, CommitPlan, CommitProgress, FolderRow, Library, NodeKey, NodeKind, PlaybackStatus, Sample, TreePage, TreeRequest,
  TreeRow,
  VirtualFolder,
} from "./types";

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

let SYNONYMS = DEFAULT_SYNONYMS.map((g) => [...g]);

function matchToken(s: Sample, t: QueryToken): boolean {
  switch (t.kind) {
    case "text":
    case "phrase": {
      const hay = `${s.name} ${s.path} ${s.tags.join(" ")}`.toLowerCase();
      // Un mot libre d'un groupe de synonymes : un seul des mots suffit.
      const words = (t.kind === "text" && expandSynonym(SYNONYMS, t.value)) || [t.value.toLowerCase()];
      return words.some((w) => hay.includes(w));
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
          if (t.value === "hidden") return hiddenEff(s);
          return t.value === "untagged" ? s.tags.length === 0 : false;
        case "in": {
          const v = t.value.toLowerCase();
          // Collection, sinon dossier virtuel (avec ses sous-dossiers), sinon chemin.
          const c = COLLECTIONS.find((c) => c.name.toLowerCase().startsWith(v));
          if (c) return collectionSamples(c.id).some((x) => x.id === s.id);
          const vf = VIRTUAL_FOLDERS.find((f) => f.name.toLowerCase().startsWith(v));
          if (vf) return subtreeSamples(vf.id).some((x) => x.id === s.id);
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
const folderParent = new Map<number, number | null>();
function indexFolders(nodes: FolderNode[], parent: number | null = null) {
  for (const n of nodes) {
    folders.set(n.id, n);
    folderParent.set(n.id, parent);
    indexFolders(n.children, n.id);
  }
}
indexFolders(SOURCES);

// Même ordre que le cœur Rust (crate-core/src/natural.rs), indépendant de la locale.
const byName = (a: { name: string }, b: { name: string }) => naturalCompare(a.name, b.name);

const collById = (id: number) => COLLECTIONS.find((c) => c.id === id);
const vfById = (id: number) => VIRTUAL_FOLDERS.find((f) => f.id === id);
const vfChildren = (id: number | null) => VIRTUAL_FOLDERS.filter((f) => f.parentId === id).sort(byName);

function collectionSamples(id: number): Sample[] {
  const c = collById(id);
  if (!c) return [];
  if (c.kind === "smart") return SAMPLES.filter((s) => matchLine(s, c.query ?? ""));
  const ids = COLLECTION_ITEMS[c.id] ?? [];
  return SAMPLES.filter((s) => ids.includes(s.id));
}

/** Samples propres à un dossier virtuel (pas ceux de ses sous-dossiers). */
function ownSamples(id: number): Sample[] {
  const ids = VIRTUAL_ITEMS[id] ?? [];
  return SAMPLES.filter((s) => ids.includes(s.id));
}

/** Samples d'un dossier virtuel et de tous ses descendants (pour `in:` et le commit à plat). */
function subtreeSamples(id: number): Sample[] {
  const seen = new Set<number>();
  const out: Sample[] = [];
  const visit = (fid: number) => {
    for (const s of ownSamples(fid)) if (!seen.has(s.id)) (seen.add(s.id), out.push(s));
    for (const c of vfChildren(fid)) visit(c.id);
  };
  visit(id);
  return out;
}

interface NodeInfo {
  key: NodeKey;
  name: string;
  kind: NodeKind;
  offline?: boolean;
  pinned?: boolean;
  target?: NodeKey;
  hidden?: boolean;
}

// ---------- Masquage (fichiers et dossiers ; jamais de suppression) ----------

const HIDDEN_FOLDERS = new Set<number>();

function folderHidden(id: number): boolean {
  for (let f: number | null | undefined = id; f !== null && f !== undefined; f = folderParent.get(f)) if (HIDDEN_FOLDERS.has(f)) return true;
  return false;
}

/** Masqué, lui-même ou par un dossier parent. */
const hiddenEff = (s: Sample) => s.hidden || folderHidden(s.folderId);

const folderInfo = (f: FolderNode): NodeInfo => ({
  key: `f:${f.id}`,
  name: f.name,
  kind: "folder",
  offline: f.offline,
  hidden: HIDDEN_FOLDERS.has(f.id),
});
const shortcutInfo = (f: FolderNode): NodeInfo => ({ key: `p:${f.id}`, name: f.name, kind: "shortcut", target: `f:${f.id}` });
const favInfo = (): NodeInfo => ({ key: "c:fav", name: "Favoris", kind: "favorites", pinned: FAVORITES.pinned });
const collInfo = (c: Collection): NodeInfo => ({ key: `c:${c.id}`, name: c.name, kind: c.kind === "smart" ? "smart" : "collection", pinned: c.pinned });
const vfInfo = (f: VirtualFolder): NodeInfo => ({ key: `v:${f.id}`, name: f.name, kind: "virtual", pinned: f.pinned });

/** Enfants d'un nœud ; `key === null` = racine de l'onglet. */
function childNodes(root: TreeRequest["root"], key: NodeKey | null, searching: boolean): NodeInfo[] {
  if (key === null) {
    // Virtuels : favoris, collections (groupe), dossiers virtuels.
    if (root === "virtual") return [favInfo(), { key: "g:collections", name: "Collections", kind: "group" }, ...vfChildren(null).map(vfInfo)];
    // Bibliothèque : sources, puis (hors recherche, pour éviter les doublons) favoris, collections et dossiers épinglés.
    if (searching) return SOURCES.map(folderInfo);
    return [
      ...SOURCES.map(folderInfo),
      ...PINNED_FOLDERS.flatMap((id) => (folders.has(id) ? [folders.get(id)!] : [])).sort(byName).map(shortcutInfo),
      ...(FAVORITES.pinned ? [favInfo()] : []),
      ...COLLECTIONS.filter((c) => c.pinned).sort(byName).map(collInfo),
      ...VIRTUAL_FOLDERS.filter((f) => f.pinned).sort(byName).map(vfInfo),
    ];
  }
  if (key === "g:collections") return COLLECTIONS.map(collInfo);
  if (key.startsWith("f:")) return folders.get(+key.slice(2))?.children.map(folderInfo) ?? [];
  if (key.startsWith("v:")) return vfChildren(+key.slice(2)).map(vfInfo);
  return [];
}

function childSamples(key: NodeKey): Sample[] {
  let list: Sample[] = [];
  if (key.startsWith("f:")) list = SAMPLES.filter((s) => s.folderId === +key.slice(2));
  else if (key === "c:fav") list = SAMPLES.filter((s) => s.fav);
  else if (key.startsWith("c:")) list = collectionSamples(+key.slice(2));
  else if (key.startsWith("v:")) list = ownSamples(+key.slice(2));
  return list.sort(byName);
}

// ---------- Commit (« Créer un vrai dossier ») ----------

/** Taille estimée d'un fichier PCM (en-tête de 44 octets compris). */
const sizeOf = (s: Sample) => Math.round((s.durationMs / 1000) * s.sampleRate * s.channels * (s.bitDepth / 8)) + 44;

/** Fichiers à copier : sous-dossier relatif dans le nouveau dossier → sample. Collections et favoris : à plat. */
function commitEntries(key: NodeKey, options: CommitOptions): { rel: string[]; sample: Sample }[] {
  if (!key.startsWith("v:")) return childSamples(key).map((sample) => ({ rel: [], sample }));
  const id = +key.slice(2);
  if (!options.keepHierarchy) return subtreeSamples(id).sort(byName).map((sample) => ({ rel: [], sample }));
  const out: { rel: string[]; sample: Sample }[] = [];
  const visit = (fid: number, rel: string[]) => {
    for (const sample of ownSamples(fid).sort(byName)) out.push({ rel, sample });
    for (const c of vfChildren(fid)) visit(c.id, [...rel, c.name]);
  };
  visit(id, []);
  return out;
}

function commitFolders(key: NodeKey, options: CommitOptions): string[][] {
  if (!key.startsWith("v:") || !options.keepHierarchy) return [];
  const out: string[][] = [];
  const visit = (fid: number, rel: string[]) => {
    for (const c of vfChildren(fid)) {
      const r = [...rel, c.name];
      out.push(r);
      visit(c.id, r);
    }
  };
  visit(+key.slice(2), []);
  return out;
}

const byId = new Map(SAMPLES.map((s) => [s.id, s]));
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;
const nextId = (xs: { id: number }[]) => Math.max(0, ...xs.map((x) => x.id)) + 1;

const commitListeners = new Set<(p: CommitProgress) => void>();

// ---------- Lecture factice (navigateur) : même déroulé que le lecteur Rust, sans son ----------

const listeners = new Set<(s: PlaybackStatus) => void>();
const playback = { volume: 1, looping: false };
let voice: { id: number; durationMs: number; t0: number; startMs: number; timer: number } | null = null;

function emit(s: PlaybackStatus) {
  for (const l of listeners) l(s);
}

function tick() {
  if (!voice) return;
  const v = voice;
  let pos = v.startMs + (performance.now() - v.t0);
  if (pos >= v.durationMs && playback.looping && v.durationMs > 0) {
    v.startMs = 0;
    v.t0 = performance.now();
    pos = 0;
  }
  const playing = pos < v.durationMs;
  emit({ id: v.id, positionMs: Math.min(pos, v.durationMs), durationMs: v.durationMs, playing, looping: playback.looping, error: false });
  if (!playing) stopVoice();
}

function stopVoice() {
  if (voice) clearInterval(voice.timer);
  voice = null;
}

export const mockBackend: Backend = {
  async library(): Promise<Library> {
    const names = [...new Set<string>([...TAGS, ...SAMPLES.flatMap((s) => s.tags)])];
    const tags = names.map((name) => ({ name, count: SAMPLES.filter((s) => s.tags.includes(name)).length })).sort(
      (a, b) => b.count - a.count,
    );
    return {
      total: SAMPLES.length,
      tags,
      collections: COLLECTIONS.map((c) => ({ ...c })),
      virtualFolders: VIRTUAL_FOLDERS.map((f) => ({ ...f })),
      favoritesPinned: FAVORITES.pinned,
      pinnedFolders: [...PINNED_FOLDERS],
      hidden: SAMPLES.filter(hiddenEff).length,
    };
  },

  async sources() {
    return SOURCES.map((f) => ({ id: f.id, name: f.name, path: ROOT_PATHS[f.id], offline: !!f.offline }));
  },

  async tree(req: TreeRequest): Promise<TreePage> {
    const t0 = performance.now();
    const q = req.query.trim();
    const searching = q !== "";
    // Masqués : invisibles partout, sauf si la recherche demande `is:hidden`.
    const reveal = searching && parseLine(q).some((t) => t.kind === "filter" && t.key === "is" && t.value === "hidden" && !t.negated);
    const match = (s: Sample) => (reveal || !hiddenEff(s)) && (!searching || matchLine(s, q));

    // Un nœud reste visible en recherche s'il contient au moins un résultat (mémoïsé par requête).
    const memo = new Map<NodeKey, boolean>();
    const hasMatch = (key: NodeKey): boolean => {
      if (!memo.has(key)) memo.set(key, childSamples(key).some(match) || childNodes(req.root, key, searching).some((n) => hasMatch(n.key)));
      return memo.get(key)!;
    };

    const rows: TreeRow[] = [];
    const walk = (key: NodeKey | null, depth: number) => {
      for (const n of childNodes(req.root, key, searching)) {
        if (!reveal && /^[fp]:/.test(n.key) && folderHidden(+n.key.slice(2))) continue;
        if (searching && !hasMatch(n.key)) continue;
        // Un raccourci ne se déplie jamais : il saute au dossier visé.
        const open = n.kind !== "shortcut" && (searching || req.expanded.includes(n.key));
        const row: FolderRow = { type: "node", key: n.key, parent: key, depth, name: n.name, kind: n.kind, open };
        if (n.offline) row.offline = true;
        if (n.pinned) row.pinned = true;
        if (n.hidden) row.hidden = true;
        if (n.target) row.target = n.target;
        rows.push(row);
        if (open) walk(n.key, depth + 1);
      }
      if (key === null) return;
      for (const s of childSamples(key)) {
        if (!match(s)) continue;
        // copies : l'UI reçoit des valeurs, comme à travers l'IPC Tauri ; pics seulement si demandés
        rows.push({ type: "sample", key: `s:${s.id}@${key}`, parent: key, depth, sample: { ...s, peaks: req.peaks ? s.peaks : [] } });
      }
    };
    walk(null, 0);

    const focus = req.focus ? rows.findIndex((r) => r.key === req.focus) : -1;
    return {
      rows: rows.slice(req.offset, req.offset + req.limit),
      totalRows: rows.length,
      matches: SAMPLES.filter(match).length,
      ...(focus >= 0 ? { focusIndex: focus } : {}),
      micros: Math.round((performance.now() - t0) * 1000),
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

  // ----- collections (à plat)

  async createCollection(name, query) {
    const c: Collection = { id: nextId(COLLECTIONS), name, kind: query ? "smart" : "manual", pinned: false };
    if (query) c.query = query;
    else COLLECTION_ITEMS[c.id] = [];
    COLLECTIONS.push(c);
    return { ...c };
  },

  async renameCollection(id, name) {
    const c = collById(id);
    if (c) c.name = name;
  },

  async deleteCollection(id) {
    const i = COLLECTIONS.findIndex((c) => c.id === id);
    if (i >= 0) COLLECTIONS.splice(i, 1);
  },

  async addToCollection(id, ids) {
    if (collById(id)?.kind !== "manual") return;
    const items = (COLLECTION_ITEMS[id] ??= []);
    for (const s of ids) if (!items.includes(s)) items.push(s);
  },

  async removeFromCollection(id, ids) {
    const items = COLLECTION_ITEMS[id];
    if (items) COLLECTION_ITEMS[id] = items.filter((s) => !ids.includes(s));
  },

  // ----- dossiers virtuels (arborescence)

  async createVirtualFolder(name, parentId) {
    const f: VirtualFolder = { id: nextId(VIRTUAL_FOLDERS), name, parentId: parentId !== null && vfById(parentId) ? parentId : null, pinned: false };
    VIRTUAL_FOLDERS.push(f);
    VIRTUAL_ITEMS[f.id] = [];
    return { ...f };
  },

  async renameVirtualFolder(id, name) {
    const f = vfById(id);
    if (f) f.name = name;
  },

  async deleteVirtualFolder(id) {
    const doomed = new Set<number>([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of VIRTUAL_FOLDERS) {
        if (f.parentId !== null && doomed.has(f.parentId) && !doomed.has(f.id)) {
          doomed.add(f.id);
          grew = true;
        }
      }
    }
    for (let i = VIRTUAL_FOLDERS.length - 1; i >= 0; i--) if (doomed.has(VIRTUAL_FOLDERS[i].id)) VIRTUAL_FOLDERS.splice(i, 1);
  },

  async moveVirtualFolder(id, parentId) {
    const f = vfById(id);
    if (!f) return;
    if (parentId !== null) {
      if (!vfById(parentId)) return;
      // Refusé vers soi-même ou un descendant.
      for (let p: number | null = parentId; p !== null; p = vfById(p)?.parentId ?? null) if (p === id) return;
    }
    f.parentId = parentId;
  },

  async addToVirtualFolder(id, ids) {
    if (!vfById(id)) return;
    const items = (VIRTUAL_ITEMS[id] ??= []);
    for (const s of ids) if (!items.includes(s)) items.push(s);
  },

  async removeFromVirtualFolder(id, ids) {
    const items = VIRTUAL_ITEMS[id];
    if (items) VIRTUAL_ITEMS[id] = items.filter((s) => !ids.includes(s));
  },

  async setPinned(key, pinned) {
    if (key.startsWith("f:")) {
      // Raccourci : seulement pour un sous-dossier (une source est déjà à la racine).
      const id = +key.slice(2);
      const i = PINNED_FOLDERS.indexOf(id);
      if (pinned && i < 0 && folderParent.get(id) != null) PINNED_FOLDERS.push(id);
      if (!pinned && i >= 0) PINNED_FOLDERS.splice(i, 1);
    } else if (key === "c:fav") FAVORITES.pinned = pinned;
    else if (key.startsWith("c:")) {
      const c = collById(+key.slice(2));
      if (c) c.pinned = pinned;
    } else if (key.startsWith("v:")) {
      const f = vfById(+key.slice(2));
      if (f) f.pinned = pinned;
    }
  },

  async ancestors(key) {
    const chain: NodeKey[] = [];
    if (key.startsWith("f:")) {
      for (let p = folderParent.get(+key.slice(2)) ?? null; p !== null; p = folderParent.get(p) ?? null) chain.unshift(`f:${p}`);
    } else if (key.startsWith("v:")) {
      for (let p = vfById(+key.slice(2))?.parentId ?? null; p !== null; p = vfById(p)?.parentId ?? null) chain.unshift(`v:${p}`);
    }
    return chain;
  },

  async setHidden(ids, hidden) {
    for (const id of ids) {
      const s = byId.get(id);
      if (s) s.hidden = hidden;
    }
  },

  async setFolderHidden(id, hidden) {
    if (hidden) HIDDEN_FOLDERS.add(id);
    else HIDDEN_FOLDERS.delete(id);
  },

  async peaks(id) {
    return byId.get(id)?.peaks ?? [];
  },

  async synonyms() {
    return SYNONYMS.map((g) => [...g]);
  },

  async setSynonyms(groups) {
    SYNONYMS = normalizeSynonyms(groups);
  },

  async nodePath(key) {
    if (!key.startsWith("f:") && !key.startsWith("p:")) return null;
    const parts: string[] = [];
    let id: number | null = +key.slice(2);
    while (id !== null) {
      const parent: number | null | undefined = folderParent.get(id);
      if (parent === undefined) return null;
      parts.unshift(parent === null ? ROOT_PATHS[id] : folders.get(id)!.name);
      id = parent;
    }
    return parts.join("/");
  },

  // ----- « Créer un vrai dossier »

  async planCommit(key, options): Promise<CommitPlan> {
    const entries = commitEntries(key, options);
    const ok = entries.filter((e) => !e.sample.missing);
    return {
      files: ok.length,
      folders: commitFolders(key, options).length,
      bytes: ok.reduce((n, e) => n + sizeOf(e.sample), 0),
      missing: entries.length - ok.length,
    };
  },

  async commitToFolder(key, destination, options) {
    // Navigateur : aucun fichier n'est écrit. Progression simulée (~1,2 s), puis le résultat et, si demandé,
    // une nouvelle source qui reflète l'arborescence copiée (la fenêtre copie vraiment, voir library.rs).
    const all = commitEntries(key, options);
    const entries = all.filter((e) => !e.sample.missing);
    for (let i = 1; i <= 12; i++) {
      await new Promise((r) => setTimeout(r, 100));
      for (const l of commitListeners) l({ done: Math.round((entries.length * i) / 12), total: entries.length });
    }
    const dest = destination.replace(/\/+$/, "");
    if (options.addAsSource) {
      let nextFolder = Math.max(999, ...folders.keys()) + 1;
      let nextSample = nextId(SAMPLES);
      const root: FolderNode = { id: nextFolder++, name: basename(dest), count: 0, children: [] };
      ROOT_PATHS[root.id] = dest;
      const nodeFor = new Map<string, FolderNode>([["", root]]);
      for (const rel of commitFolders(key, options)) {
        const n: FolderNode = { id: nextFolder++, name: rel[rel.length - 1], count: 0, children: [] };
        nodeFor.get(rel.slice(0, -1).join("/"))!.children.push(n);
        nodeFor.set(rel.join("/"), n);
      }
      for (const { rel, sample } of entries) {
        const copy: Sample = {
          ...sample,
          id: nextSample++,
          folderId: nodeFor.get(rel.join("/"))!.id,
          path: [dest, ...rel, `${sample.name}.${sample.ext}`].join("/"),
          tags: [...sample.tags],
        };
        SAMPLES.push(copy);
        byId.set(copy.id, copy);
      }
      SOURCES.push(root);
      indexFolders([root]);
    }
    return { destination: dest, copied: entries.length, skipped: all.length - entries.length };
  },

  async addSource(path) {
    // Navigateur : aucun disque n'est lu ; une source vide, comme dans la bibliothèque factice Rust.
    const id = Math.max(999, ...folders.keys()) + 1;
    const clean = path.replace(/\/+$/, "");
    const name = clean.split("/").pop() || clean;
    const root: FolderNode = { id, name, count: 0, children: [] };
    ROOT_PATHS[id] = clean;
    indexFolders([root]);
    SOURCES.push(root);
    return { id, name, path: clean, offline: false };
  },

  async refreshSource() {},

  async pickFolder() {
    return null;
  },

  async isDemo() {
    return true;
  },

  async scanStatus() {
    return null;
  },

  onScanStatus() {
    return () => {};
  },

  async play(id, startMs) {
    const s = byId.get(id);
    if (voice) {
      const old = voice;
      stopVoice();
      emit({ id: old.id, positionMs: 0, durationMs: old.durationMs, playing: false, looping: playback.looping, error: false });
    }
    if (!s) return;
    if (s.missing) {
      emit({ id, positionMs: 0, durationMs: s.durationMs, playing: false, looping: playback.looping, error: true });
      return;
    }
    voice = { id, durationMs: s.durationMs, t0: performance.now(), startMs, timer: 0 };
    voice.timer = window.setInterval(tick, 33);
    emit({ id, positionMs: startMs, durationMs: s.durationMs, playing: true, looping: playback.looping, latencyMs: 0, error: false });
  },

  async stop() {
    if (!voice) return;
    const v = voice;
    stopVoice();
    emit({ id: v.id, positionMs: 0, durationMs: v.durationMs, playing: false, looping: playback.looping, error: false });
  },

  async seek(ms) {
    if (!voice) return;
    voice.startMs = ms;
    voice.t0 = performance.now();
  },

  async setPlayback(options) {
    Object.assign(playback, options);
  },

  onCommitProgress(cb) {
    commitListeners.add(cb);
    return () => commitListeners.delete(cb);
  },

  onPlayback(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  async removeSource(id) {
    const i = SOURCES.findIndex((f) => f.id === id);
    if (i >= 0) SOURCES.splice(i, 1);
  },

  async revealInFinder() {
    // Phase 5 : commande Rust (opener).
  },
};

/** Réservé aux scénarios de démo : marque des fichiers comme introuvables. */
export function mockSetMissing(ids: number[]) {
  for (const s of SAMPLES) s.missing = ids.includes(s.id);
}
