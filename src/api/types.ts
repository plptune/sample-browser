// Contrat UI ↔ backend.
// Phase 0 : implémenté par src/api/mock.ts.
// Phase 1 : mêmes signatures, implémentées par des commandes Tauri (types générés par tauri-specta).

export type SampleId = number;

export type SampleKind = "oneshot" | "loop";

export interface Sample {
  id: SampleId;
  name: string; // sans extension
  ext: string; // "wav", "aif"…
  path: string;
  folderId: number;
  durationMs: number;
  sampleRate: number;
  bitDepth: number;
  channels: 1 | 2;
  bpm: number | null;
  key: string | null; // "Am", "F#"…
  kind: SampleKind;
  tags: string[];
  missing: boolean;
  fav: boolean;
  peaks: number[]; // 256 valeurs 0..1
}

export interface Tag {
  name: string;
  count: number;
}

export interface Collection {
  id: number;
  name: string;
  kind: "manual" | "smart";
  query?: string; // ligne de recherche brute pour une smart collection
}

/**
 * Nœud de l'arbre. Clés stables :
 * "f:<id>" dossier source · "g:collections" groupe des collections · "c:fav" favoris · "c:<id>" collection.
 */
export type NodeKey = string;

export type NodeKind = "folder" | "group" | "favorites" | "collection" | "smart";

export interface FolderRow {
  type: "node";
  key: NodeKey;
  parent: NodeKey | null;
  depth: number;
  name: string;
  kind: NodeKind;
  open: boolean;
  offline?: boolean;
}

export interface SampleRow {
  type: "sample";
  key: string; // "s:<id>@<parent>" — un sample peut apparaître dans un dossier et une collection
  parent: NodeKey;
  depth: number;
  sample: Sample;
}

export type TreeRow = FolderRow | SampleRow;

export interface TreeRequest {
  /** Ligne de recherche brute. Non vide : l'arbre est élagué aux dossiers qui contiennent
   *  des résultats, tous ouverts, et `expanded` est ignoré. */
  query: string;
  expanded: NodeKey[];
  offset: number;
  limit: number;
}

export interface TreePage {
  rows: TreeRow[]; // lignes visibles, dans l'ordre d'affichage (dossiers puis samples à chaque niveau)
  totalRows: number;
  matches: number; // nombre de samples correspondant à la recherche
}

export interface Library {
  total: number;
  tags: Tag[];
  collections: Collection[];
}

export interface Source {
  id: number;
  name: string;
  path: string;
  offline: boolean;
}

export interface Backend {
  library(): Promise<Library>;
  sources(): Promise<Source[]>;
  tree(req: TreeRequest): Promise<TreePage>;
  setFavorite(ids: SampleId[], fav: boolean): Promise<void>;
  addTag(ids: SampleId[], tag: string): Promise<void>;
  removeTag(ids: SampleId[], tag: string): Promise<void>;
  /** Collection manuelle si `query` est absent, smart sinon (la ligne de recherche brute). */
  createCollection(name: string, query?: string): Promise<Collection>;
  renameCollection(id: number, name: string): Promise<void>;
  deleteCollection(id: number): Promise<void>;
  addToCollection(id: number, ids: SampleId[]): Promise<void>;
  removeSource(id: number): Promise<void>;
  revealInFinder(path: string): Promise<void>;
}
