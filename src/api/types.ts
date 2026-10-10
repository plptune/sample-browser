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
  channels: number; // 1 ou 2
  bpm: number | null;
  key: string | null; // "Am", "F#"…
  kind: SampleKind;
  tags: string[];
  missing: boolean;
  fav: boolean;
  hidden: boolean; // masqué lui-même (pas via son dossier) : invisible sauf avec `is:hidden`
  peaks: number[]; // 256 valeurs 0..1
}

export interface Tag {
  name: string;
  count: number;
}

/** Collection : simple regroupement de samples, à plat (aucun sous-dossier). Smart = recherche enregistrée. */
export interface Collection {
  id: number;
  name: string;
  kind: "manual" | "smart";
  pinned: boolean; // aussi affichée à la racine de l'onglet « Bibliothèque »
  query?: string | null; // ligne de recherche brute d'une collection smart
}

/**
 * Dossier virtuel : arborescence sans déplacer les fichiers. Contient des samples et d'autres dossiers virtuels
 * (`parentId`). Peut devenir un vrai dossier (« Créer un vrai dossier »).
 */
export interface VirtualFolder {
  id: number;
  name: string;
  parentId: number | null; // null = racine de l'onglet « Virtuels »
  pinned: boolean; // aussi affiché à la racine de l'onglet « Bibliothèque »
}

/**
 * Nœud de l'arbre. Clés stables :
 * "f:<id>" dossier source · "p:<id>" raccourci vers un dossier source · "c:fav" favoris ·
 * "g:collections" groupe des collections · "c:<id>" collection · "v:<id>" dossier virtuel.
 */
export type NodeKey = string;

export type NodeKind = "folder" | "shortcut" | "favorites" | "group" | "collection" | "smart" | "virtual";

/** Onglet : sources (+ dossiers virtuels épinglés) ou dossiers virtuels. */
export type TreeRoot = "library" | "virtual";

export interface FolderRow {
  type: "node";
  key: NodeKey;
  parent: NodeKey | null;
  depth: number;
  name: string;
  kind: NodeKind;
  open: boolean;
  offline?: boolean | null;
  /** Collection ou dossier virtuel épinglé (marqué d'une icône dans l'onglet Bibliothèque). */
  pinned?: boolean | null;
  /** Dossier masqué (n'apparaît qu'avec `is:hidden`). */
  hidden?: boolean | null;
  /** Dossier aplati (`TreeRequest.flattened`). */
  flattened?: boolean | null;
  /** Raccourci : le dossier source visé ("f:<id>"). Un raccourci ne se déplie pas, il y saute. */
  target?: NodeKey | null;
}

export interface SampleRow {
  type: "sample";
  key: string; // "s:<id>@<parent>" — un sample peut apparaître dans un dossier source et des dossiers virtuels
  parent: NodeKey;
  depth: number;
  sample: Sample;
}

export type TreeRow = FolderRow | SampleRow;

export interface TreeRequest {
  root: TreeRoot;
  /** Ligne de recherche brute. Non vide : l'arbre est élagué aux dossiers qui contiennent
   *  des résultats, tous ouverts, et `expanded` est ignoré. */
  query: string;
  expanded: NodeKey[];
  offset: number;
  limit: number;
  /** Pics de waveform dans les lignes (densité « waveform » seulement) ; sinon `sample.peaks` est vide. */
  peaks?: boolean;
  /** Ligne dont on veut la position (`TreePage.focusIndex`), pour y faire défiler l'arbre. */
  focus?: string | null;
  /** Résultats à plat : en recherche, seulement les samples trouvés (une fois chacun), profondeur 0, sans dossiers. */
  flat?: boolean;
  /** Dossiers aplatis (filtre temporaire) : ouverts, toute leur sous-arborescence à plat. Ignoré en recherche. */
  flattened?: NodeKey[];
}

/** Forme d'onde détaillée (tiroir, inspecteur) : par colonne, min, max (−1..1) et RMS (0..1), normalisés. */
export interface Waveform {
  min: number[];
  max: number[];
  rms: number[];
}

export interface TreePage {
  rows: TreeRow[]; // lignes visibles, dans l'ordre d'affichage (dossiers puis samples à chaque niveau)
  totalRows: number;
  matches: number; // nombre de samples correspondant à la recherche
  focusIndex?: number | null; // position de `TreeRequest.focus` dans l'arbre complet, s'il y est
  micros: number; // temps de calcul côté backend (overlay de mesures)
}

export interface Library {
  total: number;
  tags: Tag[];
  collections: Collection[];
  virtualFolders: VirtualFolder[];
  favoritesPinned: boolean;
  pinnedFolders: number[]; // dossiers sources épinglés comme raccourcis dans Bibliothèque
  hidden: number; // samples masqués (eux-mêmes ou par leur dossier)
}

/** Ce que « Créer un vrai dossier » copierait (dossier virtuel, collection ou favoris). */
export interface CommitPlan {
  files: number;
  folders: number; // sous-dossiers créés (0 si l'arborescence est aplatie)
  bytes: number;
  missing: number; // fichiers introuvables, ignorés
}

export interface CommitOptions {
  keepHierarchy: boolean; // recrée les sous-dossiers virtuels ; sinon tout à plat (toujours le cas d'une collection)
  addAsSource: boolean; // le nouveau dossier devient une source indexée
}

export interface CommitResult {
  destination: string;
  copied: number;
  skipped: number;
}

export interface CommitProgress {
  done: number;
  total: number;
}

export interface Source {
  id: number;
  name: string;
  path: string;
  offline: boolean;
}

/** Progression de l'indexation d'une source (événement, au plus 5 par seconde). */
export interface ScanStatus {
  sourceId: number;
  folder: string; // dossier en cours (nom affiché)
  done: number; // fichiers lus / à lire ; 0 / 0 pendant le parcours des dossiers
  total: number;
  finished: boolean;
}

/** Analyse de fond (tempo, tonalité, boucle / one-shot) depuis le dernier départ ; done === total : rien en attente. */
export interface AnalysisStatus {
  done: number;
  total: number;
}

/** État de la lecture (événement ~30 fois par seconde pendant la lecture, puis un dernier à l'arrêt). */
export interface PlaybackStatus {
  id: SampleId;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  looping: boolean;
  latencyMs?: number | null; // délai demande → premier son (une fois par lecture)
  error: boolean; // fichier illisible
}

export interface PlaybackOptions {
  volume: number; // 0..1
  looping: boolean;
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
  removeFromCollection(id: number, ids: SampleId[]): Promise<void>;
  createVirtualFolder(name: string, parentId: number | null): Promise<VirtualFolder>;
  renameVirtualFolder(id: number, name: string): Promise<void>;
  /** Supprime aussi les sous-dossiers virtuels ; les fichiers ne sont jamais touchés. */
  deleteVirtualFolder(id: number): Promise<void>;
  /** Déplace sous `parentId` (null = racine). Refusé vers soi-même ou un descendant. */
  moveVirtualFolder(id: number, parentId: number | null): Promise<void>;
  addToVirtualFolder(id: number, ids: SampleId[]): Promise<void>;
  removeFromVirtualFolder(id: number, ids: SampleId[]): Promise<void>;
  /** Épingle "c:fav", "c:<id>", "v:<id>" ou un sous-dossier source "f:<id>" (raccourci) à la racine de Bibliothèque. */
  setPinned(key: NodeKey, pinned: boolean): Promise<void>;
  /** Clés des parents d'un nœud, de la racine au parent direct (pour y sauter en ouvrant l'arbre). */
  ancestors(key: NodeKey): Promise<NodeKey[]>;
  /** Masque (ou ré-affiche) des samples ; rien n'est touché sur le disque. */
  setHidden(ids: SampleId[], hidden: boolean): Promise<void>;
  /** Masque (ou ré-affiche) un dossier source et tout ce qu'il contient. */
  setFolderHidden(id: number, hidden: boolean): Promise<void>;
  /** Pics de waveform d'un sample (256 valeurs 0..1 ; vide tant qu'ils ne sont pas calculés). */
  peaks(id: SampleId): Promise<number[]>;
  /** Forme d'onde détaillée en `buckets` colonnes (la largeur affichée). */
  waveform(id: SampleId, buckets: number): Promise<Waveform>;
  /** Groupes de synonymes : un mot libre d'un groupe trouve aussi les autres (« kick » trouve « bd »). */
  synonyms(): Promise<string[][]>;
  setSynonyms(groups: string[][]): Promise<void>;
  /** Chemin sur le disque d'un dossier source ("f:<id>") ou d'un raccourci ("p:<id>") ; null sinon. */
  nodePath(key: NodeKey): Promise<string | null>;
  /** Collections manuelles ("c:<id>") puis dossiers virtuels ("v:<id>") qui contiennent ce sample. */
  memberships(id: SampleId): Promise<NodeKey[]>;
  planCommit(key: NodeKey, options: CommitOptions): Promise<CommitPlan>;
  /**
   * Copie les fichiers vers un nouveau dossier réel. Ne modifie ni ne déplace jamais les sources.
   * Rejetée (message lisible) si la destination existe et n'est pas vide.
   */
  commitToFolder(key: NodeKey, destination: string, options: CommitOptions): Promise<CommitResult>;
  /** Avancement de la copie en cours (fichiers copiés / à copier) ; renvoie la fonction de désabonnement. */
  onCommitProgress(cb: (p: CommitProgress) => void): () => void;
  /** Ajoute un dossier comme source et lance son indexation. Rejetée (message lisible) s'il est déjà couvert. */
  addSource(path: string): Promise<Source>;
  /** Relance l'indexation d'une source (rescan incrémental). */
  refreshSource(id: number): Promise<void>;
  removeSource(id: number): Promise<void>;
  /** Sélecteur de dossier natif ; null si annulé (ou hors de la fenêtre Tauri). */
  pickFolder(): Promise<string | null>;
  /** Vrai sur les données du prototype (navigateur, Storybook, ou fenêtre lancée avec CRATE_DEMO=1). */
  isDemo(): Promise<boolean>;
  /** Scan en cours (null sinon) : pour un scan lancé avant que l'UI n'écoute les événements. */
  scanStatus(): Promise<ScanStatus | null>;
  /** Avancement de l'analyse de fond (interrogé par les Réglages). */
  analysisStatus(): Promise<AnalysisStatus>;
  /** S'abonne à la progression de l'indexation ; renvoie la fonction de désabonnement. */
  onScanStatus(cb: (s: ScanStatus) => void): () => void;
  /** Dossier : l'ouvre dans le Finder. Fichier : ouvre son dossier et le sélectionne. */
  revealInFinder(path: string): Promise<void>;
  /** Lit un sample (un seul à la fois) à partir de `startMs`. */
  play(id: SampleId, startMs: number): Promise<void>;
  stop(): Promise<void>;
  /** Se place à `ms` dans le sample en cours. */
  seek(ms: number): Promise<void>;
  setPlayback(options: PlaybackOptions): Promise<void>;
  /** S'abonne à la position de lecture ; renvoie la fonction de désabonnement. */
  onPlayback(cb: (s: PlaybackStatus) => void): () => void;
}
