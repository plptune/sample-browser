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
  folderId: number; // nœud de l'arbre des sources
  durationMs: number;
  sampleRate: number;
  bitDepth: number;
  channels: 1 | 2;
  bpm: number | null;
  key: string | null; // "Am", "F#"…
  kind: SampleKind;
  tags: string[];
  fav: boolean;
  missing: boolean;
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
  count: number;
}

export interface FolderNode {
  id: number;
  name: string;
  count: number;
  offline?: boolean;
  children: FolderNode[];
}

export type Scope =
  | { type: "all" }
  | { type: "fav" }
  | { type: "untagged" }
  | { type: "recent" }
  | { type: "collection"; id: number }
  | { type: "folder"; id: number };

export type SortKey = "name" | "bpm" | "key" | "dur";

export interface SearchRequest {
  scope: Scope;
  query: string; // ligne brute, chips comprises
  sort: SortKey;
  offset: number;
  limit: number;
}

export interface SearchPage {
  items: Sample[];
  total: number;
}

export interface Library {
  total: number;
  favCount: number;
  untaggedCount: number;
  recentCount: number;
  tags: Tag[];
  collections: Collection[];
  sources: FolderNode[];
}

export interface Backend {
  library(): Promise<Library>;
  search(req: SearchRequest): Promise<SearchPage>;
  setFavorite(ids: SampleId[], fav: boolean): Promise<void>;
  addTag(ids: SampleId[], tag: string): Promise<void>;
  removeTag(ids: SampleId[], tag: string): Promise<void>;
  renameCollection(id: number, name: string): Promise<void>;
}
