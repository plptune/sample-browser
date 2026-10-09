// Backend réel de la fenêtre Tauri : chaque méthode du contrat appelle la commande Rust correspondante
// (src-tauri/src/lib.rs). Les fonctions `commands` et leurs types sont générés (bindings.ts).
import { commands } from "./bindings";
import type { Backend } from "./types";

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
  removeSource: (id) => commands.removeSource(id),
  revealInFinder: (path) => commands.revealInFinder(path),
};

/** Démo uniquement : marque des fichiers comme introuvables côté Rust. */
export const tauriDemoSetMissing = (ids: number[]) => commands.demoSetMissing(ids);
