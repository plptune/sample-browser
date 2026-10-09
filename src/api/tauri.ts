// Backend réel de la fenêtre Tauri : chaque méthode du contrat appelle la commande Rust correspondante
// (src-tauri/src/lib.rs). Les fonctions `commands` et leurs types sont générés (bindings.ts).
import { commands, events } from "./bindings";
import type { Backend } from "./types";

/** Commande qui peut échouer : l'erreur Rust (message lisible) devient une promesse rejetée. */
async function unwrap<T>(r: Promise<{ status: "ok"; data: T } | { status: "error"; error: string }>): Promise<T> {
  const x = await r;
  if (x.status === "error") throw new Error(x.error);
  return x.data;
}

export const tauriBackend: Backend = {
  library: () => commands.library(),
  sources: () => commands.sources(),
  tree: (req) => commands.tree(req),
  setFavorite: (ids, fav) => commands.setFavorite(ids, fav),
  addTag: (ids, tag) => commands.addTag(ids, tag),
  removeTag: (ids, tag) => commands.removeTag(ids, tag),
  createCollection: (name, query) => commands.createCollection(name, query ?? null),
  renameCollection: (id, name) => commands.renameCollection(id, name),
  deleteCollection: (id) => commands.deleteCollection(id),
  addToCollection: (id, ids) => commands.addToCollection(id, ids),
  removeFromCollection: (id, ids) => commands.removeFromCollection(id, ids),
  createVirtualFolder: (name, parentId) => commands.createVirtualFolder(name, parentId),
  renameVirtualFolder: (id, name) => commands.renameVirtualFolder(id, name),
  deleteVirtualFolder: (id) => commands.deleteVirtualFolder(id),
  moveVirtualFolder: (id, parentId) => commands.moveVirtualFolder(id, parentId),
  addToVirtualFolder: (id, ids) => commands.addToVirtualFolder(id, ids),
  removeFromVirtualFolder: (id, ids) => commands.removeFromVirtualFolder(id, ids),
  setPinned: (key, pinned) => commands.setPinned(key, pinned),
  ancestors: (key) => commands.ancestors(key),
  nodePath: (key) => commands.nodePath(key),
  planCommit: (key, options) => commands.planCommit(key, options),
  commitToFolder: (key, destination, options) => unwrap(commands.commitToFolder(key, destination, options)),
  addSource: (path) => unwrap(commands.addSource(path)),
  refreshSource: (id) => commands.refreshSource(id),
  removeSource: (id) => commands.removeSource(id),
  pickFolder: () => commands.pickFolder(),
  isDemo: () => commands.isDemo(),
  scanStatus: () => commands.scanStatus(),
  onScanStatus: (cb) => {
    const off = events.scanEvent.listen((e) => cb(e.payload));
    return () => void off.then((un) => un());
  },
  revealInFinder: (path) => commands.revealInFinder(path),
};

/** Démo uniquement : marque des fichiers comme introuvables côté Rust. */
export const tauriDemoSetMissing = (ids: number[]) => commands.demoSetMissing(ids);
