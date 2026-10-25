// État de l'app (signaux Solid). Toute donnée vient de `api` ; ici on ne garde que l'état d'UI.

import { batch, createEffect, createRoot, createSignal, on } from "solid-js";
import {
  type AnalysisStatus, type BitwigState,
  api, type CommitOptions, type CommitPlan, type CommitResult, type Library, type ListRequest, type ListSort, type NodeKey, type Sample, type SortColumn,
  type SampleId, type ScanStatus, type Source, type SpliceSync,
  type TreeRequest, type TreeRoot,
} from "../api";
import type { DawShortcutConfig, Frame } from "../api/bindings";

/** Une colonne de la liste du mode grand. */
export interface ListColumn {
  id: SortColumn;
  visible: boolean;
}
/** Colonnes d'origine (« Reset columns ») : toutes, le type juste après le nom. */
const DEFAULT_COLUMNS: ListColumn[] = (["name", "kind", "bpm", "key", "duration", "format", "tags"] as const).map((id) => ({ id, visible: true }));
import { inTauri } from "../lib/env";
import { normalizeTag } from "../lib/autotag";
import { DEFAULT_DAW_SHORTCUT, migrateDawApps } from "../lib/shortcut";
import { isChip } from "../lib/query";
import { relativePath } from "../lib/format";
import { createListModel, type ListModel, type PageTiming } from "./listModel";

/** Colonne étroite à côté du DAW, ou fenêtre bibliothèque (explorer, preview, liste à plat triable). */
export type Layout = "side" | "full";
/** Zone du clavier : une région du DOM. En mode grand, le panneau Library, le panneau Virtual ou la liste ; en colonne,
 *  l'arbre de l'onglet (sa racine). */
export type Zone = TreeRoot | "list";
/** Panneaux affichés à gauche du mode grand. */
export type Panels = Record<TreeRoot, boolean>;
export type SelectMode = "replace" | "toggle" | "range";

export type Density = "compact" | "wave";
export type ThemePref = "dark" | "light" | "system";
/** Taille du texte (Réglages › Apparence) : S, M (défaut), L. */
export type FontSize = "sm" | "base" | "lg";
/** Couleurs de base modifiables, par thème ; absentes = celles du design system. */
export type ColorRole = "accent" | "bg";
export type ColorOverrides = Partial<Record<"dark" | "light", Partial<Record<ColorRole, string>>>>;

export interface MenuState {
  x: number;
  y: number;
  /** Ligne visée, ou "root" pour le fond de l'arbre. */
  rowKey: string;
}

export interface CommitState {
  key: NodeKey;
  name: string;
  flat: boolean; // collection ou favoris : toujours à plat
  destination: string;
  options: CommitOptions;
  plan: CommitPlan | null;
  status: "idle" | "running" | "done";
  progress: number; // 0..1 pendant la copie
  result: CommitResult | null;
  error: string | null; // copie refusée (dossier existant non vide…)
}

/** Synchronisation des tags Splice (Réglages › Sources) : en cours, bilan, tags retirés, ou erreur (Splice absent…). */
export type SpliceSyncState =
  | { status: "running" }
  | { status: "done"; report: SpliceSync }
  | { status: "cleared"; removed: number }
  | { status: "error"; error: string };

/** Mesures de la dernière requête d'arbre (overlay ⌥⌘D), en millisecondes. */
export interface Metrics {
  rust: number; // calcul côté backend
  ipc: number; // aller-retour complet vu de l'UI (calcul compris)
  dom: number; // mise à jour des lignes à l'écran (synchrone)
  frame: number; // attente de l'image suivante (dépend de l'écran, pas de l'app)
  rows: number;
  matches: number;
}

function createAppState() {
  // --- données reçues du backend
  const [library, setLibrary] = createSignal<Library | null>(null);
  const [metrics, setMetrics] = createSignal<Metrics | null>(null); // overlay ⌥⌘D
  const [debug, setDebug] = createSignal(false);

  // --- recherche
  const [chips, setChips] = createSignal<string[]>([]);
  const [draft, setDraft] = createSignal("");

  // --- onglets : « Bibliothèque » (sources + épinglés) et « Virtuels » (favoris, collections, dossiers virtuels)
  const [tab, setTabSignal] = createSignal<TreeRoot>("library");
  const [expandedByTab, setExpandedByTab] = createSignal<Record<TreeRoot, NodeKey[]>>({ library: [], virtual: [] });
  const expanded = () => expandedByTab()[tab()];
  const setExpanded = (keys: NodeKey[], t: TreeRoot = tab()) => setExpandedByTab({ ...expandedByTab(), [t]: keys });

  // --- lecture (curseurs et sélections : dans les listes, plus bas)
  const [current, setCurrent] = createSignal<Sample | null>(null); // dernier sample sélectionné (tiroir)
  const [playingId, setPlayingId] = createSignal<SampleId | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [autoPlay, setAutoPlay] = createSignal(true); // ↑/↓ et clic lisent tout de suite
  const [listFocused, setListFocused] = createSignal(false);
  const [dropTarget, setDropTarget] = createSignal<NodeKey | null>(null);
  const [draggingKey, setDraggingKey] = createSignal<string | null>(null);
  /** Fichiers glissés depuis une autre app (Finder, Sononym…) au-dessus de la fenêtre : déposables comme des samples. */
  const [externalDrag, setExternalDrag] = createSignal(false);

  // --- mode : données du prototype (scénarios de démo) ou vraie bibliothèque (fenêtre Tauri)
  const [demo, setDemo] = createSignal(true);
  const [notice, setNoticeSignal] = createSignal<string | null>(null); // message bref sous la recherche
  const [fileOver, setFileOver] = createSignal(false); // dossier du Finder survolant la fenêtre

  // --- états globaux (simulés en démo)
  const [empty, setEmpty] = createSignal(false); // premier lancement : aucune source
  const [scan, setScan] = createSignal<{ done: number; total: number; folder: string } | null>(null);
  const [visibleLimit, setVisibleLimit] = createSignal<number | null>(null); // arbre qui se remplit pendant le scan

  // --- surcouches (une seule à la fois) et vues
  const [view, setView] = createSignal<"browser" | "settings" | "commit">("browser");
  const [commit, setCommit] = createSignal<CommitState | null>(null);
  const [spliceSync, setSpliceSync] = createSignal<SpliceSyncState | null>(null);
  const [tagging, setTagging] = createSignal(false); // popover de tags sur la sélection
  const [saving, setSaving] = createSignal<string | null>(null); // nom en cours pour ⌘S, null = fermé
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [renamingKey, setRenamingKey] = createSignal<NodeKey | null>(null);
  const [sources, setSources] = createSignal<Source[]>([]);
  const [alwaysOnTop, setAlwaysOnTop] = createSignal(false);

  // --- réglages d'affichage
  const [themePref, setThemePref] = createSignal<ThemePref>("dark");
  const theme = (): "dark" | "light" =>
    themePref() === "system"
      ? window.matchMedia?.("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : (themePref() as "dark" | "light");
  const setTheme = (t: ThemePref) => setThemePref(t);
  const [width, setWidth] = createSignal(320);
  const [density, setDensitySignal] = createSignal<Density>("compact");
  // Les pics ne voyagent qu'en densité « waveform » : changer de densité recharge l'arbre.
  const setDensity = (d: Density) => {
    if (d === density()) return;
    setDensitySignal(d);
    void refresh();
  };
  const [grid, setGrid] = createSignal(false);
  const [fontSize, setFontSize] = createSignal<FontSize>("base");
  const [colorOverrides, setColorOverrides] = createSignal<ColorOverrides>({});
  /** Couleurs modifiées du thème affiché. */
  const colors = () => colorOverrides()[theme()] ?? {};
  /** Change (ou, avec `null`, rend au design system) une couleur du thème affiché. */
  function setColor(role: ColorRole, value: string | null) {
    const t = theme();
    const cur = { ...(colorOverrides()[t] ?? {}) };
    if (value === null) delete cur[role];
    else cur[role] = value;
    setColorOverrides({ ...colorOverrides(), [t]: cur });
  }
  const resetColors = () => setColorOverrides({ ...colorOverrides(), [theme()]: {} });

  const queryLine = () => [...chips(), draft()].join(" ").trim();
  // Les tokens spéciaux encore en cours de frappe (#ta, bpm:1…) ne filtrent pas : seul le texte libre filtre en direct.
  const searchLine = () => [...chips(), ...draft().split(/\s+/).filter((t) => t && !isChip(t))].join(" ");
  const searching = () => searchLine() !== "";
  // En recherche, l'arbre est ouvert sauf les nœuds refermés à la main ; une autre recherche les rouvre tous. Après ⌘←
  // (`all`), c'est l'inverse : tout est refermé, et `keys` liste les nœuds rouverts à la main.
  const [collapsedFor, setCollapsedFor] = createSignal<{ line: string; keys: NodeKey[]; all?: boolean }>({ line: "", keys: [] });
  const collapsed = () => (collapsedFor().line === searchLine() ? collapsedFor().keys : []);
  const collapseAllOn = () => collapsedFor().line === searchLine() && !!collapsedFor().all;

  // Une recherche remet les filtres (dossiers aplatis) à zéro.
  createEffect(
    on(searching, (on) => {
      if (on && flattened().length) setFlattened([]);
    }),
  );

  // Option de recherche (bouton Flatten) : résultats à plat (samples seulement, sans l'arborescence).
  const [flatResults, setFlatResultsSignal] = createSignal(false);
  const setFlatResults = (v: boolean) => {
    setFlatResultsSignal(v);
    if (!v) setShuffleFor({ line: "", seed: null });
    if (searching()) void refresh();
  };
  // Shuffle (résultats à plat) : graine de l'ordre aléatoire, valable pour cette recherche seulement.
  const [shuffleFor, setShuffleFor] = createSignal<{ line: string; seed: number | null }>({ line: "", seed: null });
  const shuffle = () => (shuffleFor().line === searchLine() ? shuffleFor().seed : null);
  // Toute modification de la recherche oublie le mélange (même si l'on revient ensuite au même texte).
  createEffect(
    on(searchLine, (line) => {
      if (shuffleFor().seed !== null && shuffleFor().line !== line) setShuffleFor({ line: "", seed: null });
    }),
  );
  /** Nouvel ordre aléatoire des résultats à plat (chaque clic sur Shuffle). */
  function reshuffle() {
    if (!searching() || !flatResults()) return;
    setShuffleFor({ line: searchLine(), seed: Math.floor(Math.random() * 2 ** 32) });
    void refresh();
  }
  // Filtres temporaires : dossiers aplatis (clic droit › Flatten). Une recherche les remet à zéro.
  const [flattened, setFlattened] = createSignal<NodeKey[]>([]);
  const knownNames = new Map<NodeKey, string>(); // menu des filtres, portée : même si la ligne n'est plus chargée
  function flatten(key: NodeKey, on = true) {
    const cur = flattened();
    if (on === cur.includes(key)) return;
    const r = rowByKey(key);
    if (on && r?.type === "node") knownNames.set(key, r.name);
    setFlattened(on ? [...cur, key] : cur.filter((k) => k !== key));
    void refresh();
  }
  function clearFilters() {
    if (!flattened().length) return;
    setFlattened([]);
    void refresh();
  }
  const baseRequest = () => ({
    query: searchLine(),
    peaks: density() === "wave",
    flat: flatResults(),
    flattened: flattened(),
    collapsed: collapsed(),
    collapseAll: collapseAllOn(),
    shuffle: flatResults() ? shuffle() : null,
  });

  // --- mode grand : portée de la liste (le vrai dossier choisi dans le panneau Library) et tri
  /** Vrai dossier choisi dans l'explorer : il filtre la liste par une chip `path:` visible, retenue ici pour être
   *  remplacée au choix suivant (une chip `path:` tapée à la main n'est jamais touchée). */
  const [explorerChip, setExplorerChip] = createSignal<{ key: NodeKey; chip: string } | null>(null);
  /** La chip de l'explorer, tant qu'elle est dans la recherche (retirée à la main : oubliée). */
  const explorerPath = () => {
    const e = explorerChip();
    return e && chips().includes(e.chip) ? e : null;
  };
  /** Ce qui borne la liste : le dossier de la chip `path:` posée par le panneau Library (le panneau Virtual ne filtre
   *  jamais la liste). */
  const listScope = () => explorerPath()?.key ?? null;
  const [listSort, setListSortSignal] = createSignal<ListSort>({ column: "name", desc: false });
  /** Colonnes de la liste du mode grand : ordre et affichage (clic droit sur l'en-tête, en-têtes tirés). */
  const [listColumns, setListColumns] = createSignal<ListColumn[]>(DEFAULT_COLUMNS);
  const [zoneSig, setZoneSignal] = createSignal<Zone>("library");
  /** En colonne, toujours l'arbre de l'onglet. */
  const zone = (): Zone => (layout() === "full" ? zoneSig() : tab());
  /** Dernier panneau (mode grand) qui a eu le clavier : ← depuis la liste et ⌘← y reviennent. */
  const [lastTree, setLastTree] = createSignal<TreeRoot>("library");
  const setZone = (z: Zone) => {
    setZoneSignal(z);
    if (z !== "list") setLastTree(z);
  };
  /** Largeur de l'explorer tirée à la main (px) ; null : la largeur par défaut (34 % de la fenêtre). */
  const [explorerWidth, setExplorerWidth] = createSignal<number | null>(null);
  /** Mode grand : panneaux Library et Virtual affichés (⌘1 / ⌘2, boutons de la barre titre). */
  const [panels, setPanels] = createSignal<Panels>({ library: true, virtual: true });
  /** Part de la hauteur donnée au panneau Library quand les deux sont affichés (0..1) ; null : moitié. */
  const [panelSplit, setPanelSplit] = createSignal<number | null>(null);
  /** Mode grand : le modèle qui porte la sélection de samples, la liste ou le panneau Virtual (un seul à la fois). */
  const [sampleZone, setSampleZone] = createSignal<"list" | "virtual">("list");

  /** Arbre d'une racine. En colonne, celui de l'onglet ; en mode grand, le panneau Library ne montre que des dossiers
   *  (la recherche n'y sert qu'à révéler les dossiers masqués, les éléments virtuels épinglés n'y sont pas) et le
   *  panneau Virtual ses éléments avec leurs samples, jamais en recherche ni en densité waveform. */
  const libRequest = (): Omit<TreeRequest, "offset" | "limit"> =>
    layout() === "full"
      ? { root: "library", query: chips().includes("is:hidden") ? "is:hidden" : "", expanded: expandedByTab().library, foldersOnly: true }
      : { ...baseRequest(), root: "library", expanded: expandedByTab().library };
  const virtRequest = (): Omit<TreeRequest, "offset" | "limit"> =>
    layout() === "full"
      ? { root: "virtual", query: "", expanded: expandedByTab().virtual, peaks: false, flat: false, flattened: [], collapsed: [], shuffle: null }
      : { ...baseRequest(), root: "virtual", expanded: expandedByTab().virtual };
  const listRequest = (): Omit<ListRequest, "offset" | "limit"> => ({ scope: null, query: searchLine(), sort: listSort() });

  const onLoaded = ({ page, t0, t1, t2 }: PageTiming) =>
    requestAnimationFrame(() =>
      setMetrics({
        rust: page.micros / 1000,
        ipc: t1 - t0,
        dom: t2 - t1,
        frame: performance.now() - t2,
        rows: page.totalRows,
        matches: page.matches,
      }),
    );
  // Le tiroir et la preview gardent leur sample à jour (favori, tags) s'il est chargé.
  const refreshCurrent = () => {
    const cur = current();
    const fresh = cur ? samples().sampleById(cur.id) : undefined;
    if (fresh) setCurrent(fresh);
  };
  /** Un arbre par racine (onglet en colonne, panneau en mode grand). Nouvelle recherche, autre mode ou nouveau
   *  mélange : il repart du haut. */
  const treeModel = (request: () => Omit<TreeRequest, "offset" | "limit">) =>
    createListModel({
      request,
      fetch: (r) => api.tree(r),
      signature: (r) => `${layout()}\n${r.query}\n${r.shuffle ?? ""}`,
      visibleLimit,
      onRefreshed: refreshCurrent,
      onLoaded,
    });
  const trees: Record<TreeRoot, ListModel> = { library: treeModel(libRequest), virtual: treeModel(virtRequest) };
  const libTree = trees.library;
  const virtTree = trees.virtual;
  /** Liste à plat du mode grand (portée, recherche, tri). */
  const results = createListModel({
    request: listRequest,
    fetch: (r) => api.list(r),
    signature: (r) => `${r.scope ?? ""}\n${r.query}\n${r.sort?.column}\n${r.sort?.desc}`,
    onRefreshed: refreshCurrent,
    onLoaded,
  });

  const full = () => layout() === "full";
  /** Racine d'une clé d'après sa nature : vrais dossiers et raccourcis dans Bibliothèque, le reste dans Virtuels (un
   *  sample suit son conteneur). */
  const rootOf = (key: string): TreeRoot => (/^[fp]:/.test(key.startsWith("s:") ? key.slice(key.indexOf("@") + 1) : key) ? "library" : "virtual");
  /** Racine de l'arbre qui montre `key` : en colonne, l'onglet (il montre aussi les éléments épinglés). */
  const treeRootOf = (key: string): TreeRoot => (full() ? rootOf(key) : tab());
  const treeOf = (key: string): ListModel => trees[treeRootOf(key)];
  /** Arbre de l'onglet (colonne), ou panneau qui a ou a eu le clavier (mode grand). */
  const activeTree = (): ListModel => trees[full() ? (zone() === "list" ? lastTree() : (zone() as TreeRoot)) : tab()];
  /** Panneau du mode grand qui reçoit le clavier en quittant la liste : le dernier utilisé s'il est affiché ; null
   *  quand les deux sont masqués. En colonne, l'onglet. */
  const treeZone = (): TreeRoot | null => {
    if (!full()) return tab();
    const p = panels();
    return p[lastTree()] ? lastTree() : p.library ? "library" : p.virtual ? "virtual" : null;
  };
  /** Arbres à l'écran : l'onglet en colonne, les panneaux affichés en mode grand. */
  const shownTrees = (): ListModel[] => (full() ? (["library", "virtual"] as const).filter((t) => panels()[t]).map((t) => trees[t]) : [trees[tab()]]);
  const visibleModels = (): ListModel[] => (full() ? [...shownTrees(), results] : shownTrees());
  /** Modèle qui porte les samples : l'arbre en colonne ; en mode grand, la liste ou le panneau Virtual. */
  const samples = (): ListModel => (!full() ? trees[tab()] : sampleZone() === "virtual" ? virtTree : results);
  /** Modèle qui montre `key` (une ligne de sample de la liste ou du panneau Virtual, un nœud de l'un des arbres). */
  const modelFor = (key: string): ListModel => {
    if (!full()) return trees[tab()];
    if (key.startsWith("s:")) {
      if (results.indexOf(key) >= 0) return results;
      if (virtTree.indexOf(key) >= 0) return virtTree;
      return rootOf(key) === "library" ? results : virtTree;
    }
    return trees[rootOf(key)];
  };
  /** Modèle du curseur clavier : en mode grand, celui de la zone. */
  const focusModel = (): ListModel => (!full() ? trees[tab()] : zone() === "list" ? results : trees[zone() as TreeRoot]);
  const cursor = () => focusModel().cursor();
  const selection = () => samples().selection();
  const rowByKey = (key: string | null) => {
    if (!key) return undefined;
    const r = modelFor(key).rowByKey(key);
    if (r) return r;
    for (const m of visibleModels()) {
      const x = m.rowByKey(key);
      if (x) return x;
    }
    return undefined;
  };
  const visible = () => samples().visible();
  const matches = () => samples().matches();
  const shownTotal = () => trees[tab()].shownTotal();
  /** L'arbre de la colonne est en recherche (les panneaux du mode grand ne le sont jamais). */
  const treeSearching = () => !full() && searching();

  /** Recharge ce qui est à l'écran ; `focusKey` : la ligne à garder chargée (le curseur par défaut), dans le modèle
   *  qui la montre. */
  async function refresh(focusKey?: string | null) {
    if (!full()) {
      const m = trees[tab()];
      await m.refresh(focusKey === undefined ? m.cursor() : focusKey);
      return;
    }
    const target = focusKey ? modelFor(focusKey) : null;
    await Promise.all(visibleModels().map((m) => m.refresh(m === target ? focusKey : m.cursor())));
  }

  /** Scénarios de démo : curseur et sélection, dans toutes les listes. */
  const setCursor = (key: string | null) => (key ? modelFor(key).setCursor(key) : [libTree, virtTree, results].forEach((m) => m.setCursor(null)));
  const setSelection = (keys: string[]) => {
    for (const m of [libTree, virtTree, results]) m.setSelection(keys);
  };

  async function reloadLibrary() {
    const [lib, src] = await Promise.all([api.library(), api.sources()]);
    batch(() => {
      setLibrary(lib);
      setSources(src);
    });
  }

  const sampleById = (id: SampleId | null) => {
    if (id === null) return undefined;
    const s = samples().sampleById(id);
    if (s) return s;
    const cur = current();
    return cur?.id === id ? cur : undefined;
  };

  // --- deux modes d'affichage, séparés : la colonne à côté du DAW et la fenêtre bibliothèque. Le mode ne change que
  // par le bouton de la barre titre ou ⌘⇧F ; côté fenêtre, chacun impose ses contraintes (src-tauri/src/mode.rs).
  const [layout, setLayoutSignal] = createSignal<Layout>("side");
  /** Cadre de la colonne (points), rendu en revenant de la fenêtre bibliothèque ; gardé dans les réglages. */
  const [sideFrame, setSideFrame] = createSignal<Frame | null>(null);
  /** Largeur maximale de la colonne, en points (comme `SIDE_MAX_W` dans src-tauri/src/mode.rs). */
  const SIDE_MAX_W = 600;
  /** Pendant un changement de mode, la fenêtre bouge : ce n'est pas un cadre de colonne à garder. */
  let switchingUntil = 0;

  /** Change de mode. `initial` : au lancement, applique le mode (et ses contraintes) même s'il ne change pas. */
  async function setLayout(next: Layout, initial = false) {
    if (next === layout() && !initial) return;
    closeOverlays();
    switchingUntil = performance.now() + 1000;
    if (inTauri) {
      const { commands } = await import("../api/bindings");
      const r = await commands.setWindowMode(next === "full", next === "side" ? sideFrame() : null);
      if (r.status === "error") setNotice(r.error);
      else if (r.data) setSideFrame(r.data);
      switchingUntil = performance.now() + 600;
    } else setWidth(next === "full" ? 1200 : 320); // prototype : la fausse fenêtre s'élargit
    if (next === layout()) return;
    await (next === "full" ? enterFull() : enterSide());
  }
  /** ⌘⇧F ou le bouton de la barre titre. */
  const toggleLayout = () => setLayout(layout() === "full" ? "side" : "full");

  /** Colonne → bibliothèque. Le dossier sous le curseur (ou celui du sample sélectionné) : un vrai dossier filtre la
   *  liste par une chip `path:` ; un élément virtuel (dossier virtuel, collection, favoris) est montré dans le panneau
   *  Virtual, déplié, sans filtrer la liste. Le sample courant reste sélectionné, sans relancer la lecture : dans la
   *  liste, ou dans le panneau Virtual s'il y était rangé (la liste n'y pose alors que son curseur). */
  async function enterFull() {
    const side = trees[tab()];
    const row = side.rowByKey(side.cursor());
    const key = searching() || !row ? null : row.type === "node" ? (row.target ?? row.key) : row.parent;
    if (key && row?.type === "node") knownNames.set(key, row.name);
    const cur = current();
    const real = !!key?.startsWith("f:");
    const virt = !!key && !real;
    // Ligne à sélectionner dans le panneau Virtual : le sample tel qu'il y est rangé, ou le nœud.
    const vKey = virt ? (row?.type === "sample" ? row.key : key) : null;
    const up = virt ? await api.ancestors(key!) : [];
    // Curseurs posés une fois les lignes chargées : les listes, neuves, défilent alors jusqu'à eux.
    const chip = real ? await pathChip(key!) : null;
    batch(() => {
      setLayoutSignal("full");
      setZone(virt ? "virtual" : "list");
      setSampleZone("list");
      if (chip && key) {
        setChips([...chips().filter((c) => c !== chip), chip]);
        setExplorerChip({ key, chip });
      }
      if (virt) {
        setPanels({ ...panels(), virtual: true });
        setExpanded([...new Set([...expandedByTab().virtual, ...up, ...(row?.type === "sample" ? [key!] : [])])], "virtual");
      }
      for (const m of [libTree, virtTree, results]) {
        m.setCursor(null);
        m.setSelection([]);
      }
    });
    const [, , fi] = await Promise.all([
      panels().library ? libTree.refresh(real ? key : null) : null,
      panels().virtual ? virtTree.refresh(vKey) : null,
      results.refresh(cur ? `s:${cur.id}` : null),
    ]);
    if (real && libTree.rowByKey(key)) libTree.setCursor(key);
    const vr = vKey ? virtTree.rowByKey(vKey) : undefined;
    batch(() => {
      if (vr) virtTree.setCursor(vr.key);
      if (vr?.type === "sample") {
        virtTree.setSelected([vr.key]);
        virtTree.setAnchor(vr.key);
        setSampleZone("virtual");
      }
      const r = fi === null ? undefined : results.rows()[fi];
      if (r?.type !== "sample") return;
      results.setCursor(r.key);
      if (vr?.type === "sample") return;
      results.setSelected([r.key]);
      results.setAnchor(r.key);
    });
    focusList(vr ? "virtual" : "list");
  }

  /** Bibliothèque → colonne : la recherche reste ; l'arbre s'ouvre jusqu'au sample courant (celui de la liste ou du
   *  panneau Virtual), sélectionné. */
  async function enterSide() {
    // La chip `path:` posée par le panneau Library ne vaut qu'ici ; une chip tapée à la main reste.
    const e = explorerPath();
    if (e) setChips(chips().filter((c) => c !== e.chip));
    setExplorerChip(null);
    const from = samples();
    const row = from.rowByKey(from.cursor());
    const parent = row?.type === "sample" ? row.parent : null;
    if (parent && !searching()) {
      // Colonne : Library seule (un parent virtuel n'y paraît que sous un dossier épinglé).
      const t: TreeRoot = "library";
      const up = await api.ancestors(parent);
      setTabSignal(t);
      setExpanded([...new Set([...expandedByTab()[t], ...up, parent])], t);
    }
    const tree = trees[tab()];
    batch(() => {
      setLayoutSignal("side");
      setZone(tab());
      tree.setCursor(null);
      tree.setSelection([]);
    });
    await tree.refresh(row?.key ?? null);
    const r = row ? tree.rowByKey(row.key) : undefined;
    if (r?.type === "sample") {
      batch(() => {
        tree.setCursor(r.key);
        tree.setSelected([r.key]);
        tree.setAnchor(r.key);
      });
    }
    focusList();
  }

  /** Garde le cadre de la colonne quand l'utilisateur la déplace ou la redimensionne. */
  let frameTimer = 0;
  async function watchSideFrame() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const save = () => {
      clearTimeout(frameTimer);
      frameTimer = window.setTimeout(async () => {
        if (layout() !== "side" || performance.now() < switchingUntil) return;
        const k = await win.scaleFactor();
        const [p, sz] = await Promise.all([win.outerPosition(), win.outerSize()]);
        if (layout() !== "side" || performance.now() < switchingUntil) return;
        const pos = p.toLogical(k);
        const size = sz.toLogical(k);
        setSideFrame({ x: pos.x, y: pos.y, w: size.width, h: size.height });
      }, 400);
    };
    void win.onMoved(save);
    void win.onResized(save);
  }

  /**
   * ⌘⌥← / ⌘⌥→ : cale la colonne contre le bord gauche ou droit de son écran, sur toute la hauteur utile (sans barre
   * des menus ni Dock), en gardant sa largeur. Depuis la fenêtre bibliothèque, repasse d'abord en colonne.
   */
  async function snapWindow(side: "left" | "right") {
    if (!inTauri) return;
    if (layout() === "full") await setLayout("side");
    const { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;
    const { position: area, size: room } = monitor.workArea;
    // Largeur de la colonne, jamais plus que son maximum (600 pt) : juste après la fenêtre bibliothèque, la taille lue
    // peut encore être l'ancienne.
    const width = Math.min((await win.outerSize()).width, Math.round(SIDE_MAX_W * (await win.scaleFactor())), room.width);
    await win.setSize(new PhysicalSize(width, room.height));
    await win.setPosition(new PhysicalPosition(side === "left" ? area.x : area.x + room.width - width, area.y));
  }

  // --- portée (mode grand)
  /** Chip `path:` d'un vrai dossier : son chemin depuis la source, avec son nom et un `/` final (comme à l'écran). */
  async function pathChip(key: NodeKey): Promise<string | null> {
    const abs = await api.nodePath(key);
    return abs ? `path:"${relativePath(abs.replace(/\/+$/, "") + "/", sources())}"` : null;
  }
  let scopeSeq = 0;
  /** Vrai dossier du panneau Library qui borne la liste (un raccourci vaut son dossier) ; null : tout. Il pose une
   *  chip `path:` (visible, retirable, combinable). Les autres nœuds (dossiers virtuels, collections, favoris) ne
   *  filtrent jamais la liste. */
  async function setScope(key: NodeKey | null, name?: string) {
    const k = key?.startsWith("p:") ? `f:${key.slice(2)}` : key;
    if (k && name) knownNames.set(k, name);
    const seq = ++scopeSeq;
    const old = explorerPath()?.chip;
    if (k?.startsWith("f:")) {
      if (explorerPath()?.key === k) return;
      const chip = await pathChip(k);
      // Un choix plus récent est passé entre-temps.
      if (!chip || seq !== scopeSeq) return;
      batch(() => {
        setChips([...chips().filter((c) => c !== old && c !== chip), chip]);
        setExplorerChip({ key: k, chip });
      });
      void results.refresh(results.cursor());
      return;
    }
    if (k !== null || !old) return;
    batch(() => {
      setChips(chips().filter((c) => c !== old));
      setExplorerChip(null);
    });
    void results.refresh(results.cursor());
  }
  /** Clic dans le panneau Library : la ligne devient la portée tout de suite (un saut, dans l'historique). */
  function selectExplorer(key: NodeKey) {
    const r = libTree.rowByKey(key);
    if (r?.type !== "node") return;
    const k = r.target ?? key;
    if (k !== listScope()) remember();
    select(key, "replace", libTree);
    void setScope(k, r.name);
  }
  // Flèches dans le panneau Library : la portée suit le curseur, une fois qu'il s'arrête.
  let scopeTimer = 0;
  function scheduleScope() {
    clearTimeout(scopeTimer);
    scopeTimer = window.setTimeout(() => {
      const r = libTree.rowByKey(libTree.cursor());
      if (r?.type === "node") void setScope(r.target ?? r.key, r.name);
    }, 150);
  }
  /** Toute la bibliothèque (Échap dans le panneau Library, fond du panneau). */
  function clearScope() {
    if (listScope() === null) return;
    remember();
    libTree.setCursor(null);
    void setScope(null);
  }
  /** Nom de la portée affiché au-dessus de la liste. */
  const scopeName = () => {
    const k = listScope();
    if (k === null) return "";
    // Chip de l'explorer : le dernier dossier de son chemin (le nœud n'est pas forcément chargé, l'onglet a pu changer).
    const e = explorerPath();
    const fromChip = e?.key === k ? e.chip.replace(/^path:"|\/?"$/g, "").split("/").pop() : "";
    return nodeName(k) || fromChip || knownNames.get(k) || "";
  };
  /** Affiche ou masque une colonne (le nom reste toujours). */
  function toggleColumn(id: SortColumn) {
    if (id === "name") return;
    setListColumns(listColumns().map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  }
  /** Déplace une colonne affichée à la place d'insertion `to`, comptée parmi les colonnes affichées (elle comprise). */
  function moveColumn(id: SortColumn, to: number) {
    const all = listColumns();
    const shown = all.filter((c) => c.visible).map((c) => c.id);
    const from = shown.indexOf(id);
    const at = to > from ? to - 1 : to;
    if (from < 0 || at === from) return;
    const order = shown.filter((c) => c !== id);
    order.splice(at, 0, id);
    setListColumns([...order.map((c) => ({ id: c, visible: true })), ...all.filter((c) => !c.visible)]);
  }
  const resetColumns = () => setListColumns(DEFAULT_COLUMNS);

  function setListSort(sort: ListSort) {
    setListSortSignal(sort);
    void results.refresh(results.cursor());
  }
  /** Clic sur un en-tête de colonne : trie par cette colonne, ou inverse le sens si elle trie déjà. */
  function sortBy(column: ListSort["column"]) {
    const cur = listSort();
    setListSort(cur.column === column ? { column, desc: !cur.desc } : { column, desc: false });
  }

  // --- zones du clavier : les arbres et la liste s'enregistrent pour recevoir le focus (désinscrits au démontage)
  const zoneEls: Partial<Record<Zone, HTMLElement>> = {};
  function registerZone(z: Zone, el: HTMLElement) {
    zoneEls[z] = el;
    return () => {
      if (zoneEls[z] === el) delete zoneEls[z];
    };
  }
  /** Donne le clavier à une zone (en colonne : à l'arbre de l'onglet). */
  function focusList(z: Zone = zone()) {
    const target: Zone = full() ? z : tab();
    setZone(target);
    zoneEls[target]?.focus();
  }
  /** ⌘← / ⌘→ : le clavier va à l'arbre (le panneau du mode grand qui l'avait en dernier). */
  function focusTree() {
    const z = full() && zone() !== "list" ? zone() : treeZone();
    if (z) focusList(z);
  }
  /** Tab (⇧ : à rebours) dans le mode grand : les panneaux affichés, puis la liste. */
  function nextZone(back = false): Zone {
    const order: Zone[] = [...(["library", "virtual"] as const).filter((t) => panels()[t]), "list"];
    const i = order.indexOf(zone());
    return order[(i + (back ? order.length - 1 : 1)) % order.length];
  }

  // --- panneaux du mode grand
  /** Affiche ou masque un panneau. Réaffiché : rechargé (il ne suivait plus) ; masqué avec le clavier : la liste le
   *  prend, et sa sélection de samples passe à la liste. */
  function setPanelShown(t: TreeRoot, shown: boolean) {
    if (panels()[t] === shown) return;
    batch(() => {
      setPanels({ ...panels(), [t]: shown });
      if (!shown && t === "virtual" && sampleZone() === "virtual") {
        virtTree.setSelection([]);
        setSampleZone("list");
      }
    });
    if (shown) return void trees[t].refresh();
    if (zone() === t) listFocused() ? focusList("list") : setZone("list");
  }
  const togglePanel = (t: TreeRoot) => setPanelShown(t, !panels()[t]);
  /** La racine est à l'écran : panneau affiché (mode grand) ou onglet courant (colonne). */
  const rootShown = (t: TreeRoot) => (full() ? panels()[t] : tab() === t);
  /** Met la racine à l'écran (ressort du glisser, sauts). */
  const revealRoot = (t: TreeRoot) => (full() ? setPanelShown(t, true) : void switchTab(t));
  /** ⌘1 / ⌘2 : en mode grand, affichent ou masquent le panneau ; en colonne (Library seule), ⌘1 y revient. */
  const rootShortcut = (t: TreeRoot) => (full() ? togglePanel(t) : void switchTab(t));

  // Collections et dossiers virtuels du sample courant (inspecteur du mode grand).
  const [memberships, setMemberships] = createSignal<{ key: NodeKey; name: string }[]>([]);
  createEffect(
    on([current, library, layout], ([cur, , lay]) => {
      if (!cur || lay !== "full") return setMemberships([]);
      const id = cur.id;
      void api.memberships(id).then((keys) => current()?.id === id && setMemberships(keys.map((key) => ({ key, name: nodeName(key) }))));
    }),
  );

  /** Tiroir : ajoute un tag (nouveau ou existant) aux samples sélectionnés. */
  async function addTag(tag: string) {
    const name = normalizeTag(tag) ?? "";
    // Déjà là mais posé par l'analyse ou repris de Splice : l'ajouter le fait passer aux tags de l'utilisateur.
    const ids = selectedSamples()
      .filter((s) => !s.tags.includes(name) || s.autoTags.includes(name) || s.spliceTags.includes(name))
      .map((s) => s.id);
    if (!name || !ids.length) return;
    await api.addTag(ids, name);
    await Promise.all([refresh(), reloadLibrary()]);
  }

  /** Inspecteur et tiroir : retire un tag des samples sélectionnés qui l'ont. */
  async function removeTag(tag: string) {
    const ids = selectedSamples().filter((s) => s.tags.includes(tag)).map((s) => s.id);
    if (!ids.length) return;
    await api.removeTag(ids, tag);
    await Promise.all([refresh(), reloadLibrary()]);
  }

  // Toujours au premier plan : appliqué à la vraie fenêtre, en colonne seulement (la fenêtre bibliothèque couvrirait
  // le DAW pour de bon).
  createEffect(
    on([alwaysOnTop, layout], ([v, lay]) => {
      if (inTauri) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setAlwaysOnTop(v && lay === "side"));
    }),
  );

  // Recherche depuis le DAW : le raccourci (⌘F) est pris côté Rust, seulement quand un DAW de la liste est devant.
  const [dawShortcut, setDawShortcut] = createSignal<DawShortcutConfig>(DEFAULT_DAW_SHORTCUT);
  createEffect(
    on(dawShortcut, (cfg) => {
      if (!inTauri) return;
      void import("../api/bindings").then(async ({ commands }) => {
        const r = await commands.setDawShortcut(cfg);
        if (r.status === "error") setNotice(r.error);
      });
    }),
  );
  // Redimensionner le DAW avec Crate : autorisation Accessibilité de macOS (`null` : pas encore lue, ou hors Tauri).
  const [accessibility, setAccessibility] = createSignal<boolean | null>(null);
  /** Relit l'autorisation ; avec `prompt`, macOS la demande s'il ne l'a pas. */
  async function checkAccessibility(prompt = false) {
    if (!inTauri) return;
    const { commands } = await import("../api/bindings");
    setAccessibility(await commands.accessibilityTrusted(prompt));
  }
  async function openAccessibilitySettings() {
    if (!inTauri) return;
    const { commands } = await import("../api/bindings");
    await commands.openAccessibilitySettings();
  }
  createEffect(on(() => dawShortcut().resizeTogether, (on) => on && void checkAccessibility()));

  // « Space plays Bitwig » : état du script de contrôleur de Crate dans Bitwig, et sa copie (Réglages).
  const [bitwig, setBitwig] = createSignal<BitwigState | null>(null);
  const [bitwigScript, setBitwigScript] = createSignal<{ path: string } | { error: string } | null>(null);
  api.onBitwigState(setBitwig);
  void api.bitwigStatus().then(setBitwig, () => {});
  async function installBitwigScript() {
    try {
      setBitwigScript({ path: await api.installBitwigScript() });
    } catch (e) {
      setBitwigScript({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Capture d'un raccourci dans les Réglages : le raccourci global est relâché le temps de la capture. */
  function pauseDawShortcut(paused: boolean) {
    if (!inTauri) return;
    void import("../api/bindings").then(({ commands }) => commands.pauseDawShortcut(paused));
  }

  /** Rend la main au DAW d'où l'on a sauté dans Crate (Échap dans la recherche vide, glisser terminé). */
  async function returnToDaw(): Promise<boolean> {
    if (!inTauri) return false;
    const { commands } = await import("../api/bindings");
    return commands.returnToDaw();
  }

  /** « Space plays Bitwig » : lecture / arrêt du transport de Bitwig, la preview n'est pas touchée. */
  function bitwigTogglePlay(): Promise<boolean> {
    return api.bitwigTogglePlay();
  }

  // Pics du sample du tiroir (les lignes ne les transportent qu'en densité « waveform »).
  const [currentPeaks, setCurrentPeaks] = createSignal<number[]>([]);
  createEffect(
    on(
      () => current()?.id,
      (id) => {
        setCurrentPeaks([]); // jamais les pics du sample précédent
        if (id === undefined) return;
        void api.peaks(id).then((p) => current()?.id === id && setCurrentPeaks(p));
      },
    ),
  );

  // Formes d'onde détaillées : la largeur demandée par le tiroir (ou l'inspecteur) sert aussi à précharger les
  // voisins du curseur, pour que ↓ / ↑ en lecture auto les trouvent prêtes (cache côté Rust).
  let waveBuckets = 0;
  function waveformFor(id: SampleId, buckets: number) {
    waveBuckets = buckets;
    return api.waveform(id, buckets);
  }
  let prefetchTimer = 0;
  createEffect(
    on(
      () => samples().cursor(),
      (key) => {
        clearTimeout(prefetchTimer);
        if (!waveBuckets || key == null) return;
        prefetchTimer = window.setTimeout(() => {
          const m = samples();
          const i = m.indexOf(key);
          if (i < 0) return;
          for (const j of [i + 1, i - 1, i + 2]) {
            const r = m.rows()[j];
            if (r?.type === "sample" && !r.sample.missing) void api.waveform(r.sample.id, waveBuckets);
          }
        }, 60);
      },
      { defer: true },
    ),
  );

  // --- recherche
  function setQueryDraft(v: string) {
    // Un token reconnu suivi d'un espace devient une chip.
    if (v.endsWith(" ")) {
      const parts = v.trim().split(/\s+/);
      const last = parts[parts.length - 1];
      if (last && isChip(last)) {
        // Seul le token spécial devient une chip ; les mots libres restent dans le champ.
        const rest = parts.slice(0, -1).filter(Boolean).join(" ");
        remember();
        batch(() => {
          setChips([...chips(), last]);
          setDraft(rest ? rest + " " : "");
        });
        refresh();
        return;
      }
    }
    setDraft(v);
    refresh();
  }

  /** Autocomplétion : remplace le mot en cours de frappe par cette chip (elle peut contenir des espaces). */
  function pickChip(chip: string) {
    remember();
    const parts = draft().trim().split(/\s+/).slice(0, -1).filter(Boolean);
    batch(() => {
      setChips([...chips().filter((c) => c !== chip), chip]);
      setDraft(parts.length ? parts.join(" ") + " " : "");
    });
    refresh();
  }

  function removeChip(index: number) {
    remember();
    setChips(chips().filter((_, i) => i !== index));
    refresh();
  }

  /** La recherche porte cette chip (filtres de l'entonnoir). */
  const hasChip = (chip: string) => chips().includes(chip);

  /** Filtres de l'entonnoir : ajoute la chip ou la retire ; en l'ajoutant, retire celles qui l'excluent
   *  (`type:loop` / `type:oneshot`, `key:minor` / `key:major`). */
  function toggleChip(chip: string, exclusive: string[] = []) {
    remember();
    const on = hasChip(chip);
    setChips(on ? chips().filter((c) => c !== chip) : [...chips().filter((c) => !exclusive.includes(c)), chip]);
    refresh();
  }

  function editChip(index: number) {
    const raw = chips()[index];
    batch(() => {
      setChips(chips().filter((_, i) => i !== index));
      setDraft(raw);
    });
    refresh();
  }

  function clearQuery() {
    remember();
    batch(() => {
      setChips([]);
      setDraft("");
    });
    refresh();
  }

  // --- dossiers (arbre de la colonne, panneaux du mode grand)
  /** Ouvert : hors recherche, dans `expanded` de sa racine ; en recherche, tout sauf ce qu'on a refermé (après ⌘← :
   *  seulement ce qu'on a rouvert). */
  const isOpen = (key: NodeKey) =>
    treeSearching() ? collapsed().includes(key) === collapseAllOn() : expandedByTab()[treeRootOf(key)].includes(key);

  async function setOpen(key: NodeKey, open: boolean) {
    if (open === isOpen(key)) return;
    const t = treeRootOf(key);
    if (treeSearching()) {
      // `keys` : les exceptions à l'état par défaut ; basculer un nœud l'y ajoute ou l'en retire.
      const cur = collapsed();
      const keys = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      setCollapsedFor({ line: searchLine(), keys, all: collapseAllOn() });
    } else {
      const cur = expandedByTab()[t];
      setExpanded(open ? [...cur, key] : cur.filter((k) => k !== key), t);
    }
    await trees[t].refresh();
  }

  const toggleNode = (key: NodeKey) => setOpen(key, !isOpen(key));

  /** ⌘← / ⌘→ : referme tous les dossiers de l'onglet (du panneau, en mode grand) ; le curseur remonte sur l'élément
   *  de premier niveau qui le contenait. */
  async function collapseAll() {
    const t = full() ? (zone() === "list" ? treeZone() : (zone() as TreeRoot)) : tab();
    if (!t) return;
    if (full()) setZone(t);
    const tree = trees[t];
    // Remonte par les lignes chargées (les parents sont au-dessus, en général déjà chargés).
    let top: string | null = tree.cursor();
    for (let r = tree.rowByKey(top); r?.parent; r = tree.rowByKey(r.parent)) top = r.parent;
    // En recherche, tout se referme aussi, à tous les niveaux : rouvrir un dossier ne remontre pas ses sous-dossiers.
    if (treeSearching()) setCollapsedFor({ line: searchLine(), keys: [], all: true });
    else setExpanded([], t);
    await tree.refresh();
    if (top && tree.indexOf(top) < 0) top = (await api.ancestors(top))[0] ?? null;
    if (top && tree.indexOf(top) >= 0) return select(top, "replace", tree);
    if (tree.shownTotal()) {
      await tree.ensureRange(0, 1);
      const first = tree.rows()[0];
      if (first) select(first.key, "replace", tree);
    }
  }

  // --- sélection : un sample dans un modèle qui les porte (arbre en colonne ; liste ou panneau Virtual en mode grand),
  // ou un nœud d'un arbre (curseur seulement)
  function select(key: string, mode: SelectMode = "replace", m: ListModel = modelFor(key)) {
    const i = m.indexOf(key);
    const row = i < 0 ? undefined : m.rows()[i];
    if (!row) return;
    m.setCursor(key);
    if (row.type === "node") {
      // Les samples sélectionnés d'un autre modèle (la liste, en mode grand) n'en dépendent pas.
      if (m === samples()) m.setSelected([]);
      return;
    }
    // Mode grand : une seule sélection de samples, dans la liste ou dans le panneau Virtual.
    if (full()) {
      const z = m === virtTree ? "virtual" : "list";
      if (z !== sampleZone()) {
        batch(() => {
          (z === "virtual" ? results : virtTree).setSelection([]);
          setSampleZone(z);
        });
      }
    }
    if (mode === "toggle") {
      m.toggleSelected(key);
      m.setAnchor(key);
    } else if (mode === "range" && m.indexOf(m.anchor()) >= 0) {
      const a = m.indexOf(m.anchor());
      const [lo, hi] = a < i ? [a, i] : [i, a];
      const span = m.rows().slice(lo, hi + 1);
      if (span.some((r) => r === undefined)) {
        // Pages manquantes au milieu : on les charge, puis on reprend.
        void m.ensureRange(lo, hi + 1).then(() => select(key, "range", m));
        return;
      }
      m.setSelected(span.flatMap((r) => (r?.type === "sample" ? [r.key] : [])));
    } else {
      m.setSelected([key]);
      m.setAnchor(key);
    }
    setCurrent(row.sample);
    if (autoPlay() && mode === "replace") play(row.sample.id);
  }

  async function move(delta: number, extend = false) {
    const m = focusModel();
    const n = m.shownTotal();
    if (!n) return;
    const i = m.indexOf(m.cursor());
    let next = Math.max(0, Math.min(n - 1, i < 0 ? 0 : i + delta));
    // En recherche, ↑ / ↓ ne s'arrêtent que sur les samples : les dossiers sont sautés.
    if (m !== results && treeSearching()) {
      const dir = delta < 0 ? -1 : 1;
      let j = next;
      for (; j >= 0 && j < n; j += dir) {
        await m.ensureRange(j, j + 1);
        if (m.rows()[j]?.type === "sample") break;
      }
      if (j < 0 || j >= n) return; // plus de sample dans ce sens : on reste où l'on est
      next = j;
    }
    await m.ensureRange(next, next + 1);
    const r = m.rows()[next];
    if (!r) return;
    select(r.key, extend ? "range" : "replace", m);
    if (m === libTree && full()) scheduleScope();
  }

  /** Sélectionne une ligne d'un arbre qui n'est peut-être pas chargée (parent lointain, saut). */
  async function selectKey(key: string) {
    const m = treeOf(key);
    if ((await m.locate(key)) >= 0) select(key, "replace", m);
  }

  /** → : ouvre le dossier sélectionné (le curseur reste dessus) ; un raccourci y saute. Rien sur un sample. Dans le
   *  panneau Library du mode grand, sur un dossier ouvert (ou sans sous-dossier), passe à la liste. */
  async function right() {
    if (full() && zone() === "list") return;
    const tree = focusModel();
    const row = tree.rowByKey(tree.cursor());
    if (!row) return move(0);
    if (row.type === "sample") return;
    if (row.target) return full() ? focusList("list") : jumpTo(row.target);
    if (full() && tree === libTree && (row.open || row.leaf)) return focusList("list");
    if (!row.open) return setOpen(row.key, true);
  }

  /** ← : ferme le dossier sélectionné ; sur un sample ou un dossier fermé, ferme son parent et le sélectionne. En mode
   *  grand, depuis la liste, revient au panneau (s'il y en a un d'affiché). */
  async function left() {
    if (full() && zone() === "list") {
      const z = treeZone();
      return z ? focusList(z) : undefined;
    }
    const tree = focusModel();
    const row = tree.rowByKey(tree.cursor());
    if (!row) return;
    if (row.type === "node" && row.open) return setOpen(row.key, false);
    if (!row.parent) return;
    const parent = row.parent;
    await setOpen(parent, false);
    await selectKey(parent);
    if (full() && tree === libTree) scheduleScope();
  }

  function activate() {
    const row = rowByKey(cursor());
    if (row?.type === "node") row.target ? jumpTo(row.target) : toggleNode(row.key);
    else togglePlay();
  }

  // --- lecture : moteur Rust dans la fenêtre, lecteur factice (même déroulé, sans son) dans le navigateur
  const [looping, setLoopingSignal] = createSignal(false);
  const [volume, setVolumeSignal] = createSignal(1);
  const [stopOnDrag, setStopOnDrag] = createSignal(true); // arrêter au début d'un glisser
  const [stopOnBlur, setStopOnBlur] = createSignal(true); // arrêter quand Crate passe en arrière-plan
  const [latency, setLatency] = createSignal<number | null>(null); // délai demande → premier son (⌥⌘D)

  api.onPlayback((s) => {
    batch(() => {
      if (s.latencyMs != null) setLatency(s.latencyMs);
      if (s.playing) {
        setPlayingId(s.id);
        setProgress(s.durationMs ? s.positionMs / s.durationMs : 0);
      } else if (playingId() === s.id) {
        // L'arrêt d'un sample remplacé par un autre arrive après coup : on l'ignore.
        setPlayingId(null);
        setProgress(0);
      }
    });
    if (s.error) setNotice("This file can't be played.");
  });

  function play(id: SampleId, startMs = 0) {
    const s = sampleById(id);
    if (!s || s.missing) return stop();
    batch(() => {
      setPlayingId(id);
      setProgress(s.durationMs ? startMs / s.durationMs : 0);
    });
    void api.play(id, Math.round(startMs));
  }

  function stop() {
    batch(() => {
      setPlayingId(null);
      setProgress(0);
    });
    void api.stop();
  }

  function togglePlay() {
    const s = current();
    if (!s) return;
    playingId() === s.id ? stop() : play(s.id);
  }

  /** Clic dans la waveform du tiroir : lit (ou continue) à partir de ce point. */
  function seekTo(fraction: number) {
    const s = current();
    if (!s || s.missing) return;
    const ms = Math.max(0, Math.min(1, fraction)) * s.durationMs;
    if (playingId() === s.id) {
      setProgress(fraction);
      void api.seek(Math.round(ms));
    } else play(s.id, ms);
  }

  /** ⇧← / ⇧→ : recule ou avance d'un dixième du sample courant (lit depuis ce point s'il ne joue pas). */
  function nudge(delta: number) {
    const s = current();
    if (!s) return;
    seekTo((playingId() === s.id ? progress() : 0) + delta);
  }

  function setLooping(v: boolean) {
    setLoopingSignal(v);
    void api.setPlayback({ volume: volume(), looping: v });
  }

  function setVolume(v: number) {
    setVolumeSignal(v);
    void api.setPlayback({ volume: v, looping: looping() });
  }

  /** ⌘⇧Espace : un sample au hasard parmi les lignes de l'arbre ou de la liste (chargées à la demande). */
  async function playRandom() {
    const m = samples();
    const n = m.shownTotal();
    for (let k = 0; k < 40 && n > 0; k++) {
      const i = Math.floor(Math.random() * n);
      await m.ensureRange(i, i + 1);
      const r = m.rows()[i];
      if (r?.type === "sample" && !r.sample.missing) {
        select(r.key, "replace", m);
        play(r.sample.id);
        return;
      }
    }
  }

  // --- sélection effective : la multi-sélection, sinon la ligne sous le curseur
  const selectedSamples = (): Sample[] => {
    const m = samples();
    if (m.selection().length) return m.selectedData();
    const r = m.rowByKey(m.cursor());
    return r?.type === "sample" ? [r.sample] : [];
  };

  function closeOverlays() {
    batch(() => {
      setTagging(false);
      setSaving(null);
      setMenu(null);
    });
  }

  // --- tags
  function openTagging() {
    if (!selectedSamples().length) return;
    closeOverlays();
    setTagging(true);
  }

  async function toggleTag(tag: string) {
    const samples = selectedSamples();
    const ids = samples.map((s) => s.id);
    const all = samples.every((s) => s.tags.includes(tag));
    await (all ? api.removeTag(ids, tag) : api.addTag(ids, tag));
    await Promise.all([refresh(), reloadLibrary()]);
  }

  // --- favoris : bascule sur la sélection (tous favoris → on retire, sinon on ajoute)
  async function toggleFavorite(samples = selectedSamples()) {
    if (!samples.length) return;
    const all = samples.every((s) => s.fav);
    await api.setFavorite(samples.map((s) => s.id), !all);
    await refresh();
  }

  // --- historique de navigation (⌥← / ⌥→) : un instantané avant chaque saut (onglet, recherche, raccourci).
  // Ouvrir ou fermer un dossier n'est pas un saut : l'instantané garde l'arbre tel qu'on l'a laissé.
  interface Snapshot {
    tab: TreeRoot;
    chips: string[];
    draft: string;
    expanded: Record<TreeRoot, NodeKey[]>;
    cursors: Record<TreeRoot, string | null>; // arbres (onglets en colonne, panneaux en mode grand)
    explorerChip: { key: NodeKey; chip: string } | null; // mode grand : chip `path:` posée par le panneau Library…
    listCursor: string | null; // … et curseur de la liste
  }
  const HISTORY_MAX = 50;
  const [past, setPast] = createSignal<Snapshot[]>([]);
  const [future, setFuture] = createSignal<Snapshot[]>([]);
  const snapshot = (): Snapshot => ({
    tab: tab(),
    chips: chips(),
    draft: draft(),
    expanded: expandedByTab(),
    cursors: { library: libTree.cursor(), virtual: virtTree.cursor() },
    explorerChip: explorerPath(),
    listCursor: results.cursor(),
  });
  const same = (a: Snapshot, b: Snapshot) =>
    a.tab === b.tab && a.draft === b.draft && a.cursors.library === b.cursors.library && a.cursors.virtual === b.cursors.virtual &&
    a.explorerChip?.chip === b.explorerChip?.chip && a.listCursor === b.listCursor &&
    a.chips.join("\n") === b.chips.join("\n") &&
    a.expanded.library.join() === b.expanded.library.join() && a.expanded.virtual.join() === b.expanded.virtual.join();

  function remember() {
    const now = snapshot();
    const last = past()[past().length - 1];
    if (last && same(last, now)) return;
    batch(() => {
      setPast([...past(), now].slice(-HISTORY_MAX));
      setFuture([]);
    });
  }

  async function restore(snap: Snapshot) {
    batch(() => {
      closeOverlays();
      setView("browser");
      setTabSignal(snap.tab);
      setChips(snap.chips);
      setDraft(snap.draft);
      setExpandedByTab(snap.expanded);
      setExplorerChip(snap.explorerChip);
      libTree.setCursor(snap.cursors.library);
      virtTree.setCursor(snap.cursors.virtual);
      results.setCursor(snap.listCursor);
      setSelection([]);
    });
    await refresh();
    if (full()) for (const m of shownTrees()) if (!m.rowByKey(m.cursor())) m.setCursor(null);
    // Curseur seulement (pas de lecture auto) ; un sample redevient la sélection.
    const m = samples();
    const key = m.cursor();
    const row = m.rowByKey(key);
    if (!row) m.setCursor(null);
    else if (row.type === "sample") {
      batch(() => {
        m.setSelected([row.key]);
        m.setAnchor(row.key);
        setCurrent(row.sample);
      });
    }
  }

  async function back() {
    const p = past();
    if (!p.length) return;
    const target = p[p.length - 1];
    batch(() => {
      setPast(p.slice(0, -1));
      setFuture([...future(), snapshot()]);
    });
    await restore(target);
  }

  async function forward() {
    const f = future();
    if (!f.length) return;
    const target = f[f.length - 1];
    batch(() => {
      setFuture(f.slice(0, -1));
      setPast([...past(), snapshot()]);
    });
    await restore(target);
  }

  function clearHistory() {
    batch(() => {
      setPast([]);
      setFuture([]);
    });
  }

  const canBack = () => past().length > 0;
  const canForward = () => future().length > 0;

  /** Saut vers un nœud (raccourci, appartenance de la preview). Un vrai dossier : recherche vidée, parents et dossier
   *  ouverts, et en mode grand il borne la liste (chip `path:`). Un élément virtuel en mode grand : montré dans le
   *  panneau Virtual, déplié et sélectionné, sans toucher à la liste. */
  async function jumpTo(target: NodeKey) {
    remember();
    const parents = await api.ancestors(target);
    if (full() && !target.startsWith("f:")) return revealVirtualNode(target, [...parents, target]);
    // Colonne : Library seule ; un nœud virtuel n'y est trouvé que sous un dossier épinglé.
    const t: TreeRoot = "library";
    batch(() => {
      closeOverlays();
      setView("browser");
      if (full()) setPanels({ ...panels(), library: true });
      else setTabSignal(t);
      setChips([]);
      setDraft("");
      setExpanded([...new Set([...expandedByTab()[t], ...parents, target])], t);
    });
    if (full()) await setScope(target);
    await refresh(target);
    select(target, "replace", trees[t]);
    const r = trees[t].rowByKey(target);
    if (full() && r?.type === "node") knownNames.set(target, r.name);
  }

  /** Mode grand : le panneau Virtual affiché, ces nœuds dépliés, `key` sélectionné (la liste n'en dépend pas). */
  async function revealVirtualNode(key: NodeKey, open: NodeKey[]) {
    batch(() => {
      closeOverlays();
      setView("browser");
      setPanels({ ...panels(), virtual: true });
      setExpanded([...new Set([...expandedByTab().virtual, ...open])], "virtual");
    });
    await virtTree.refresh(key);
    select(key, "replace", virtTree);
  }

  // --- onglets (colonne) ; en mode grand, les mêmes racines sont des panneaux. La colonne n'a plus que Library : les
  // dossiers virtuels utiles y sont épinglés (l'arbre Virtual en colonne ne sert plus qu'aux scénarios de démo).
  async function switchTab(t: TreeRoot) {
    if (full()) return setPanelShown(t, true);
    if (t === "virtual" || t === tab()) return;
    remember();
    const tree = trees[t];
    batch(() => {
      closeOverlays();
      setTabSignal(t);
      setZone(t);
      setView("browser");
      tree.setSelection([]);
      tree.setCursor(null);
    });
    await tree.refresh();
  }

  const nodeId = (key: NodeKey) => +key.slice(2);
  const nodeName = (key: NodeKey) => {
    const lib = library();
    if (key === "c:fav") return "Favorites";
    if (key.startsWith("c:")) return lib?.collections.find((c) => c.id === nodeId(key))?.name ?? "";
    if (key.startsWith("v:")) return lib?.virtualFolders.find((f) => f.id === nodeId(key))?.name ?? "";
    // Dossier source : nom de sa ligne (chargée), sinon celui retenu à l'aplatissement.
    const r = rowByKey(key);
    return r?.type === "node" ? r.name : (knownNames.get(key) ?? "");
  };

  /** Montre un nœud virtuel qu'on vient de créer, avec ces nœuds dépliés, puis le sélectionne (et le renomme si
   *  demandé) : dans le panneau Virtual en mode grand ; en colonne, dans Library, où un nœud de premier niveau est
   *  épinglé pour y paraître. */
  async function revealVirtual(key: NodeKey, open: NodeKey[], rename = false) {
    remember();
    const t: TreeRoot = full() ? "virtual" : "library";
    const nested = open.filter((k) => k !== "g:collections");
    if (t === "library" && !nested.length) await api.setPinned(key, true);
    batch(() => {
      if (full()) setPanels({ ...panels(), virtual: true });
      else setTabSignal("library");
      setView("browser");
      setExpanded([...new Set([...expandedByTab()[t], ...(t === "library" ? nested : open)])], t);
    });
    await Promise.all([refresh(key), reloadLibrary()]);
    if (trees[t].indexOf(key) < 0) return;
    select(key, "replace", trees[t]);
    if (rename) setRenamingKey(key);
  }

  // --- collections (à plat) et recherche enregistrée
  /** ⌘S : la recherche seule (la chip `path:` du panneau Library comprise) ; sans recherche, rien. */
  function openSaveSearch() {
    if (!searchLine()) return;
    closeOverlays();
    setSaving(queryLine());
  }

  /** Enregistre la recherche en collection smart, sélectionnée dans les Virtuels. En colonne, la recherche est vidée
   *  (la collection montre les mêmes samples) ; en mode grand, la liste garde la sienne. */
  async function saveSearch(name: string) {
    const query = searchLine();
    setSaving(null);
    if (!name.trim() || !query) return;
    const c = await api.createCollection(name.trim(), query);
    if (!full()) {
      batch(() => {
        setChips([]);
        setDraft("");
      });
    }
    await revealVirtual(`c:${c.id}`, ["g:collections"]);
  }

  /** Nouvelle collection manuelle, aussitôt en renommage. */
  async function newCollection() {
    const c = await api.createCollection("New collection");
    await revealVirtual(`c:${c.id}`, ["g:collections"], true);
  }

  // --- dossiers virtuels (arborescence)
  async function newVirtualFolder(parent: NodeKey | null = null) {
    const f = await api.createVirtualFolder("New folder", parent ? nodeId(parent) : null);
    await revealVirtual(`v:${f.id}`, parent ? [parent] : [], true);
  }

  async function renameNode(key: NodeKey, name: string) {
    setRenamingKey(null);
    const n = name.trim();
    if (n && n !== nodeName(key)) {
      if (key.startsWith("c:")) await api.renameCollection(nodeId(key), n);
      else if (key.startsWith("v:")) await api.renameVirtualFolder(nodeId(key), n);
    }
    await Promise.all([refresh(), reloadLibrary()]);
  }

  async function deleteNode(key: NodeKey) {
    if (key.startsWith("c:")) await api.deleteCollection(nodeId(key));
    else if (key.startsWith("v:")) await api.deleteVirtualFolder(nodeId(key));
    for (const m of [libTree, virtTree]) if (m.cursor() === key) m.setCursor(null);
    await Promise.all([refresh(), reloadLibrary()]);
  }

  async function togglePin(key: NodeKey) {
    const lib = library();
    if (key.startsWith("p:")) key = `f:${nodeId(key)}`; // retirer un raccourci = désépingler son dossier
    const pinned = key.startsWith("f:")
      ? lib?.pinnedFolders.includes(nodeId(key))
      : key === "c:fav"
        ? lib?.favoritesPinned
        : key.startsWith("c:")
          ? lib?.collections.find((c) => c.id === nodeId(key))?.pinned
          : lib?.virtualFolders.find((f) => f.id === nodeId(key))?.pinned;
    await api.setPinned(key, !pinned);
    await Promise.all([refresh(), reloadLibrary()]);
  }

  /** `key` est dans le bloc de `ancestor` (lui-même ou un descendant, d'après les lignes chargées des arbres). */
  function isInside(key: string, ancestor: NodeKey): boolean {
    for (let k: string | null = key, n = 0; k && n < 64; n++) {
      if (k === ancestor) return true;
      k = rowByKey(k)?.parent ?? null;
    }
    return false;
  }

  function canDrop(target: NodeKey): boolean {
    const dragged = draggingKey() ?? (externalDrag() ? "external" : null);
    if (!dragged) return false;
    // Un dossier virtuel ne se range ni en lui-même ni dans l'un de ses descendants.
    if (dragged.startsWith("v:")) return (target === "root" || (target.startsWith("v:") && !isInside(target, dragged)));
    if (target === "c:fav" || target.startsWith("v:")) return true;
    return target.startsWith("c:") && library()?.collections.find((c) => c.id === nodeId(target))?.kind === "manual";
  }

  /** Cible de dépôt pour une ligne survolée : elle-même si elle accepte, sinon le premier parent qui accepte (survoler
   *  un sample ou un sous-élément d'un dossier vise ce dossier). */
  function dropTargetFor(key: string | null): NodeKey | null {
    for (let k = key, n = 0; k && n < 64; n++) {
      if (canDrop(k)) return k;
      k = rowByKey(k)?.parent ?? null;
    }
    return null;
  }

  /** Fichiers déposés depuis une autre app sur une cible : ceux de la bibliothèque y sont ajoutés, les autres signalés
   *  (Crate n'indexe pas un fichier isolé). */
  async function dropFiles(target: NodeKey, paths: string[]) {
    const r = await api.samplesAt(paths);
    await addIdsTo(target, r.ids);
    const n = r.outside.length;
    if (n) setNotice(n === 1 ? "This file isn't in any of your sources." : `${n} files aren't in any of your sources.`);
  }

  /** Dépôt : ajoute les samples glissés, ou déplace le dossier virtuel glissé. */
  async function dropOn(target: NodeKey) {
    const dragged = draggingKey();
    const ok = canDrop(target);
    batch(() => {
      setDropTarget(null);
      setDraggingKey(null);
    });
    if (!dragged || !ok) return;
    if (dragged.startsWith("v:")) {
      await api.moveVirtualFolder(nodeId(dragged), target === "root" ? null : nodeId(target));
      if (target !== "root") setExpanded([...new Set([...expandedByTab()[treeRootOf(target)], target])], treeRootOf(target));
      await Promise.all([refresh(), reloadLibrary()]);
      return;
    }
    await addSelectionTo(target);
  }

  /** Déplace un dossier virtuel sous un autre (null = racine) : le pendant clavier du glisser. */
  async function moveVirtualFolderTo(key: NodeKey, parent: NodeKey | null) {
    await api.moveVirtualFolder(nodeId(key), parent === null ? null : nodeId(parent));
    if (parent !== null) setExpanded([...new Set([...expandedByTab()[treeRootOf(parent)], parent])], treeRootOf(parent));
    treeOf(key).setCursor(key);
    await Promise.all([refresh(key), reloadLibrary()]);
  }

  async function addSelectionTo(target: NodeKey) {
    await addIdsTo(target, selectedSamples().map((s) => s.id));
  }

  async function addIdsTo(target: NodeKey, ids: SampleId[]) {
    if (!ids.length) return;
    if (target === "c:fav") await api.setFavorite(ids, true);
    else if (target.startsWith("c:")) await api.addToCollection(nodeId(target), ids);
    else if (target.startsWith("v:")) await api.addToVirtualFolder(nodeId(target), ids);
    await refresh();
  }

  // --- masquer (jamais de suppression ; « is:hidden » les retrouve)
  async function hideSelection(hidden: boolean) {
    const ids = selectedSamples().map((s) => s.id);
    if (!ids.length) return;
    await api.setHidden(ids, hidden);
    if (hidden) samples().setSelected([]);
    await Promise.all([refresh(), reloadLibrary()]);
    if (hidden) setNotice(`${ids.length > 1 ? `${ids.length} samples hidden` : "Sample hidden"}: search “is:hidden” to find ${ids.length > 1 ? "them" : "it"} again.`);
  }

  async function hideFolder(key: NodeKey, hidden: boolean) {
    if (!key.startsWith("f:")) return;
    await api.setFolderHidden(+key.slice(2), hidden);
    await Promise.all([refresh(), reloadLibrary()]);
    if (hidden) setNotice(`Folder “${rowByKey(key)?.type === "node" ? (rowByKey(key) as { name: string }).name : ""}” hidden: search “is:hidden” to find it again.`);
  }

  /** ⌘⌫ : retire de la collection / du dossier virtuel ; ailleurs, masque. Jamais de suppression de fichier. */
  async function removeOrHide() {
    const row = rowByKey(cursor());
    if (!row) return;
    if (row.type === "node") {
      if (row.key.startsWith("f:") && row.parent !== null && !row.hidden) await hideFolder(row.key, true);
      return;
    }
    const p = row.parent;
    const manual = p.startsWith("c:") && (p === "c:fav" || library()?.collections.find((c) => `c:${c.id}` === p)?.kind === "manual");
    if (p.startsWith("v:") || manual) await removeSelectionFrom(p);
    else if (!row.sample.hidden) await hideSelection(true);
  }

  /** Retire la sélection de la collection / du dossier virtuel qui la contient (jamais du disque). */
  async function removeSelectionFrom(parent: NodeKey) {
    const ids = selectedSamples().map((s) => s.id);
    if (parent === "c:fav") await api.setFavorite(ids, false);
    else if (parent.startsWith("c:")) await api.removeFromCollection(nodeId(parent), ids);
    else if (parent.startsWith("v:")) await api.removeFromVirtualFolder(nodeId(parent), ids);
    samples().setSelection([]);
    await refresh();
  }

  // --- « Créer un vrai dossier » (copie, jamais de déplacement)
  async function openCommit(key: NodeKey) {
    closeOverlays();
    const name = nodeName(key);
    const flat = !key.startsWith("v:");
    const options = { keepHierarchy: !flat, addAsSource: false };
    setCommit({ key, name, flat, destination: `~/Desktop/${name}`, options, plan: null, status: "idle", progress: 0, result: null, error: null });
    setView("commit");
    const plan = await api.planCommit(key, options);
    setCommit((c) => (c ? { ...c, plan } : c));
  }

  async function setCommitOptions(options: CommitOptions) {
    const c = commit();
    if (!c) return;
    setCommit({ ...c, options, plan: null });
    const plan = await api.planCommit(c.key, options);
    setCommit((x) => (x ? { ...x, plan } : x));
  }

  const setCommitDestination = (destination: string) => setCommit((c) => (c ? { ...c, destination, error: null } : c));

  /** « Choisir… » : dossier parent natif, le nouveau dossier y prend le nom de l'élément copié. */
  async function chooseCommitParent() {
    const parent = await api.pickFolder();
    const c = commit();
    if (parent && c) setCommitDestination(`${parent.replace(/\/+$/, "")}/${c.name}`);
  }

  async function runCommit() {
    const c = commit();
    if (!c || c.status !== "idle" || !c.destination.trim()) return;
    setCommit({ ...c, status: "running", progress: 0, error: null });
    // Progression envoyée par la copie elle-même (Rust dans la fenêtre, simulée dans le navigateur).
    const off = api.onCommitProgress((p) => setCommit((x) => (x ? { ...x, progress: p.total ? p.done / p.total : 1 } : x)));
    let result: CommitResult;
    try {
      result = await api.commitToFolder(c.key, c.destination.trim(), c.options);
    } catch (e) {
      off();
      setCommit((x) => (x ? { ...x, status: "idle", progress: 0, error: e instanceof Error ? e.message : String(e) } : x));
      return;
    }
    off();
    setCommit((x) => (x ? { ...x, status: "done", progress: 1, result } : x));
    if (c.options.addAsSource) await Promise.all([refresh(), reloadLibrary()]);
  }

  function closeCommit() {
    batch(() => {
      setView("browser");
      setCommit(null);
    });
  }

  /** Reprend les tags de la base locale de Splice : ajoute ceux qui manquent (Réglages › Sources). */
  async function syncSpliceTags() {
    if (spliceSync()?.status === "running") return;
    setSpliceSync({ status: "running" });
    try {
      const report = await api.syncSpliceTags();
      setSpliceSync({ status: "done", report });
    } catch (e) {
      setSpliceSync({ status: "error", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    await Promise.all([refresh(), reloadLibrary()]);
  }

  async function clearSpliceTags() {
    if (spliceSync()?.status === "running") return;
    setSpliceSync({ status: "running" });
    const removed = await api.clearSpliceTags();
    setSpliceSync({ status: "cleared", removed });
    await Promise.all([refresh(), reloadLibrary()]);
  }

  async function removeSource(id: number) {
    await api.removeSource(id);
    // Le chemin de la chip du panneau Library a pu disparaître avec la source.
    const e = explorerPath();
    if (e) setChips(chips().filter((c) => c !== e.chip));
    setExplorerChip(null);
    await Promise.all([refresh(), reloadLibrary()]);
    if (!demo() && !sources().length) setEmpty(true);
  }

  // --- vraie bibliothèque : sources, indexation
  let noticeTimer = 0;
  function setNotice(text: string | null) {
    clearTimeout(noticeTimer);
    setNoticeSignal(text);
    if (text) noticeTimer = window.setTimeout(() => setNoticeSignal(null), 6000);
  }

  /** Ajoute un dossier (⌘O, dépôt depuis le Finder, Réglages). Sans chemin : sélecteur natif. */
  async function addFolder(path?: string) {
    const p = path ?? (await api.pickFolder());
    if (!p) return;
    try {
      const s = await api.addSource(p);
      batch(() => {
        setEmpty(false);
        setView("browser");
        if (full()) setPanels({ ...panels(), library: true });
        else setTabSignal("library");
      });
      await Promise.all([refresh(), reloadLibrary()]);
      setNotice(null);
      return s;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshSource(id: number) {
    await api.refreshSource(id);
  }

  // Pendant un scan : statut sous la recherche et arbre rafraîchi au plus deux fois par seconde.
  let lastScanRefresh = 0;
  function onScanStatus(s: ScanStatus) {
    if (s.finished) {
      setScan(null);
      void Promise.all([refresh(), reloadLibrary()]);
      return;
    }
    setScan({ done: s.done, total: s.total, folder: s.folder });
    const now = performance.now();
    if (now - lastScanRefresh > 500) {
      lastScanRefresh = now;
      void refresh();
    }
  }

  // --- analyse de fond (tempo, tonalité) : suivie toutes les 3 s ; tant qu'elle avance, la page visible est
  // rechargée pour que BPM et tonalité apparaissent (et que les filtres bpm: / key: les voient).
  const [analysis, setAnalysis] = createSignal<AnalysisStatus | null>(null);
  let lastAnalysisDone = -1;
  async function pollAnalysis() {
    const a = await api.analysisStatus();
    setAnalysis(a);
    if (a.done !== lastAnalysisDone && lastAnalysisDone >= 0 && !scan()) void refresh();
    lastAnalysisDone = a.done;
  }

  // --- synonymes de la recherche (Réglages)
  const [synonyms, setSynonyms] = createSignal<string[][]>([]);
  async function saveSynonyms(groups: string[][]) {
    await api.setSynonyms(groups);
    setSynonyms(await api.synonyms());
    await refresh();
  }

  // --- réglages d'interface, gardés d'un lancement à l'autre (stockage local de la fenêtre)
  const PREFS_KEY = "crate.prefs";
  interface Prefs {
    theme: ThemePref;
    density: Density;
    autoPlay: boolean;
    alwaysOnTop: boolean;
    looping: boolean;
    volume: number;
    stopOnDrag: boolean;
    stopOnBlur: boolean;
    layout: Layout;
    fontSize: FontSize;
    colors: ColorOverrides;
    dawShortcut: DawShortcutConfig;
    flatResults: boolean;
    listSort: ListSort;
    listColumns: ListColumn[];
    sideFrame: Frame | null;
    explorerWidth: number | null;
    panels: Panels;
    panelSplit: number | null;
  }
  /** Mode d'affichage mémorisé : appliqué à la fenêtre une fois l'app lancée. */
  let savedLayout: Layout = "side";
  function loadPrefs() {
    let p: Partial<Prefs> = {};
    try {
      p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    } catch {
      /* stockage indisponible : réglages par défaut */
    }
    batch(() => {
      if (p.theme) setThemePref(p.theme);
      if (p.density) setDensitySignal(p.density);
      if (typeof p.autoPlay === "boolean") setAutoPlay(p.autoPlay);
      if (typeof p.alwaysOnTop === "boolean") setAlwaysOnTop(p.alwaysOnTop);
      if (typeof p.looping === "boolean") setLoopingSignal(p.looping);
      if (typeof p.volume === "number") setVolumeSignal(Math.max(0, Math.min(1, p.volume)));
      if (typeof p.stopOnDrag === "boolean") setStopOnDrag(p.stopOnDrag);
      if (typeof p.stopOnBlur === "boolean") setStopOnBlur(p.stopOnBlur);
      if (p.layout === "full" || p.layout === "side") savedLayout = p.layout;
      if (p.fontSize === "sm" || p.fontSize === "base" || p.fontSize === "lg") setFontSize(p.fontSize);
      if (p.colors && typeof p.colors === "object") setColorOverrides(p.colors);
      if (typeof p.flatResults === "boolean") setFlatResultsSignal(p.flatResults);
      const sorts = DEFAULT_COLUMNS.map((c) => c.id as string);
      if (p.listSort && sorts.includes(p.listSort.column)) setListSortSignal({ column: p.listSort.column, desc: !!p.listSort.desc });
      // Colonnes : celles d'anciens réglages inconnues aujourd'hui sont ignorées, les nouvelles ajoutées à la fin.
      if (Array.isArray(p.listColumns)) {
        const known = p.listColumns.filter((c) => sorts.includes(c?.id)).map((c) => ({ id: c.id, visible: c.id === "name" || !!c.visible }));
        const added = DEFAULT_COLUMNS.filter((d) => !known.some((c) => c.id === d.id));
        setListColumns([...known, ...added]);
      }
      const f = p.sideFrame;
      if (f && [f.x, f.y, f.w, f.h].every((v) => typeof v === "number" && Number.isFinite(v))) setSideFrame(f);
      if (typeof p.explorerWidth === "number" && Number.isFinite(p.explorerWidth)) setExplorerWidth(p.explorerWidth);
      if (p.panels && typeof p.panels.library === "boolean" && typeof p.panels.virtual === "boolean") setPanels({ library: p.panels.library, virtual: p.panels.virtual });
      if (typeof p.panelSplit === "number" && p.panelSplit >= 0.1 && p.panelSplit <= 0.9) setPanelSplit(p.panelSplit);
      const d = p.dawShortcut;
      if (d && typeof d.enabled === "boolean" && typeof d.shortcut === "string" && Array.isArray(d.apps)) setDawShortcut({ ...DEFAULT_DAW_SHORTCUT, ...d, apps: migrateDawApps(d.apps) });
    });
  }
  function savePrefs() {
    const p: Prefs = {
      theme: themePref(),
      density: density(),
      autoPlay: autoPlay(),
      alwaysOnTop: alwaysOnTop(),
      looping: looping(),
      volume: volume(),
      stopOnDrag: stopOnDrag(),
      stopOnBlur: stopOnBlur(),
      layout: layout(),
      fontSize: fontSize(),
      colors: colorOverrides(),
      dawShortcut: dawShortcut(),
      flatResults: flatResults(),
      listSort: listSort(),
      listColumns: listColumns(),
      sideFrame: sideFrame(),
      explorerWidth: explorerWidth(),
      panels: panels(),
      panelSplit: panelSplit(),
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* pas de stockage : tant pis, rien de critique */
    }
  }

  /** Démarrage : démo (scénarios) ou vraie bibliothèque (premier lancement si aucune source). */
  async function start(): Promise<boolean> {
    void api.synonyms().then(setSynonyms);
    // Réglages : seulement dans la vraie bibliothèque (la démo repart toujours des mêmes réglages).
    const isDemoMode = await api.isDemo();
    if (!isDemoMode) {
      loadPrefs();
      createRoot(() => createEffect(savePrefs));
      void api.setPlayback({ volume: volume(), looping: looping() });
    }
    // Fenêtre : relancée dans le mode où on l'a quittée (la démo, toujours en colonne), avec ses contraintes et, en
    // colonne, à sa place.
    if (inTauri) {
      await setLayout(isDemoMode ? "side" : savedLayout, true);
      void watchSideFrame();
    }
    const isDemo = isDemoMode;
    setDemo(isDemo);
    if (isDemo) return true;
    api.onScanStatus(onScanStatus);
    void pollAnalysis();
    setInterval(() => void pollAnalysis(), 3000);
    const current = await api.scanStatus();
    if (current) onScanStatus(current);
    await reloadLibrary();
    setEmpty(!sources().length);
    await refresh();
    return false;
  }

  // --- Finder : un sample y est affiché (sélectionné dans son dossier), un dossier y est ouvert.
  async function showInFinder(path: string | null | undefined) {
    if (!path) return;
    if (!inTauri) return setNotice("“Open in Finder” works in the Mac app, not in this prototype.");
    await api.revealInFinder(path);
  }

  /** Dossier source, sous-dossier ou raccourci. */
  async function openFolderInFinder(key: NodeKey) {
    await showInFinder(await api.nodePath(key));
  }

  /** ⌥⌘R : le sample sélectionné (le premier s'il y en a plusieurs) ou le dossier sous le curseur. */
  async function finderForSelection() {
    const s = selectedSamples().find((x) => !x.missing);
    if (s) return showInFinder(s.path);
    const row = rowByKey(cursor());
    if (row?.type === "node" && !row.offline) await openFolderInFinder(row.target ?? row.key);
  }

  function openMenu(x: number, y: number, rowKey: string) {
    closeOverlays();
    const row = rowKey === "root" ? undefined : rowByKey(rowKey);
    // Clic droit hors sélection : la ligne devient la sélection, comme dans le Finder.
    if (row && !(row.type === "sample" && selection().includes(rowKey))) select(rowKey);
    setMenu({ x, y, rowKey });
  }

  return {
    view, setView, tagging, setTagging, saving, setSaving, menu, setMenu, renamingKey, setRenamingKey,
    sources, alwaysOnTop, setAlwaysOnTop, themePref, selectedSamples, closeOverlays, openTagging, toggleTag,
    toggleFavorite, openSaveSearch, saveSearch, newCollection, removeSource, openMenu,
    layout, setLayout, toggleLayout, memberships, removeTag, addTag,
    trees, libTree, virtTree, activeTree, results, zone, setZone, explorerWidth, setExplorerWidth, focusList, focusTree, nextZone, registerZone,
    panels, setPanelShown, togglePanel, panelSplit, setPanelSplit, rootShown, revealRoot, rootShortcut, sampleZone,
    listScope, scopeName, setScope, selectExplorer, clearScope, folderPaths: (prefix: string) => api.folderPaths(prefix, 8), pickChip, listSort, sortBy, listColumns, toggleColumn, moveColumn, resetColumns,
    flatResults, setFlatResults, shuffle, reshuffle, waveformFor, flattened, flatten, clearFilters, fontSize, setFontSize, colors, colorOverrides, setColor, resetColors, dawShortcut, setDawShortcut, pauseDawShortcut, returnToDaw, bitwigTogglePlay, bitwig, bitwigScript, installBitwigScript, accessibility, checkAccessibility, openAccessibilitySettings,
    tab, switchTab, nodeName, newVirtualFolder, renameNode, deleteNode, togglePin, canDrop, dropOn, dropTargetFor, dropFiles, externalDrag, setExternalDrag, moveVirtualFolderTo, addSelectionTo,
    removeSelectionFrom, commit, openCommit, setCommitOptions, setCommitDestination, runCommit, closeCommit, setTabSignal,
    spliceSync, syncSpliceTags, clearSpliceTags,
    library, visible, matches, chips, draft, expanded, cursor, selection, current, playingId, progress,
    autoPlay, listFocused, dropTarget, draggingKey, empty, scan, theme, width, density, grid, queryLine, searching,
    setAutoPlay, setListFocused, setDropTarget, setDraggingKey, setEmpty, setScan, setVisibleLimit, setTheme,
    setWidth, setDensity, setGrid, setChips, setDraft, setSelection, setCursor, setCurrent, setExpanded,
    snapWindow, refresh, reloadLibrary, rowByKey, setQueryDraft, removeChip, editChip, hasChip, toggleChip, clearQuery, setOpen, toggleNode, collapseAll,
    select, move, right, left, activate, play, stop, togglePlay, selectKey,
    shownTotal, currentPeaks, synonyms, saveSynonyms,
    hideSelection, hideFolder, removeOrHide,
    looping, setLooping, volume, setVolume, stopOnDrag, setStopOnDrag, stopOnBlur, setStopOnBlur, latency, seekTo, nudge, playRandom, analysis, metrics, debug, setDebug,
    jumpTo, back, forward, clearHistory, canBack, canForward,
    demo, notice, setNotice, fileOver, setFileOver, addFolder, refreshSource, start, showInFinder, openFolderInFinder, finderForSelection, chooseCommitParent,
  };
}

export const app = createRoot(createAppState);
export type AppState = typeof app;
