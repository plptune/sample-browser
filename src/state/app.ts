// État de l'app (signaux Solid). Toute donnée vient de `api` ; ici on ne garde que l'état d'UI.

import { batch, createEffect, createRoot, createSignal, on } from "solid-js";
import {
  type AnalysisStatus,
  api, type CommitOptions, type CommitPlan, type CommitResult, type Library, type ListRequest, type ListSort, type NodeKey, type Sample,
  type SampleId, type ScanStatus, type Source,
  type TreeRequest, type TreeRoot,
} from "../api";
import type { DawShortcutConfig, Frame } from "../api/bindings";
import { inTauri } from "../lib/env";
import { normalizeTag } from "../lib/autotag";
import { DEFAULT_DAW_SHORTCUT, migrateDawApps } from "../lib/shortcut";
import { isChip } from "../lib/query";
import { createListModel, PAGE, type ListModel, type PageTiming } from "./listModel";

/** Colonne étroite à côté du DAW, ou fenêtre bibliothèque (explorer, preview, liste à plat triable). */
export type Layout = "side" | "full";
/** Zone du clavier en mode grand : l'explorer de gauche ou la liste. En colonne, toujours l'arbre. */
export type Zone = "tree" | "list";
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
  // En recherche, l'arbre est ouvert sauf les nœuds refermés à la main ; une autre recherche les rouvre tous.
  const [collapsedFor, setCollapsedFor] = createSignal<{ line: string; keys: NodeKey[] }>({ line: "", keys: [] });
  const collapsed = () => (collapsedFor().line === searchLine() ? collapsedFor().keys : []);

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
    root: tab(),
    query: searchLine(),
    expanded: expanded(),
    peaks: density() === "wave",
    flat: flatResults(),
    flattened: flattened(),
    collapsed: collapsed(),
    shuffle: flatResults() ? shuffle() : null,
  });

  // --- mode grand : portée de la liste (un nœud de l'explorer, null = toute la bibliothèque) et tri
  const [scope, setScopeSignal] = createSignal<NodeKey | null>(null);
  const [listSort, setListSortSignal] = createSignal<ListSort>({ column: "name", desc: false });
  const [zone, setZone] = createSignal<Zone>("tree");
  /** Largeur de l'explorer tirée à la main (px) ; null : la largeur par défaut (34 % de la fenêtre). */
  const [explorerWidth, setExplorerWidth] = createSignal<number | null>(null);

  /** Arbre de la colonne, ou explorer du mode grand : dossiers seuls (la recherche n'y sert qu'à révéler les dossiers
   *  masqués). */
  const treeRequest = (): Omit<TreeRequest, "offset" | "limit"> =>
    layout() === "full"
      ? { root: tab(), query: chips().includes("is:hidden") ? "is:hidden" : "", expanded: expanded(), foldersOnly: true }
      : baseRequest();
  const listRequest = (): Omit<ListRequest, "offset" | "limit"> => ({ scope: scope(), query: searchLine(), sort: listSort() });

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
  /** Arbre (colonne) ou explorer (mode grand). Nouvelle recherche, autre onglet ou nouveau mélange : il repart du haut. */
  const tree = createListModel({
    request: treeRequest,
    fetch: (r) => api.tree(r),
    signature: (r) => `${r.root}\n${r.query}\n${r.shuffle ?? ""}\n${r.foldersOnly ? "explorer" : ""}`,
    visibleLimit,
    onRefreshed: refreshCurrent,
    onLoaded,
  });
  /** Liste à plat du mode grand (portée, recherche, tri). */
  const results = createListModel({
    request: listRequest,
    fetch: (r) => api.list(r),
    signature: (r) => `${r.scope ?? ""}\n${r.query}\n${r.sort?.column}\n${r.sort?.desc}`,
    onRefreshed: refreshCurrent,
    onLoaded,
  });

  const full = () => layout() === "full";
  /** Modèle qui porte les samples : la liste en mode grand, l'arbre en colonne. */
  const samples = (): ListModel => (full() ? results : tree);
  /** Modèle du curseur clavier : en mode grand, l'explorer ou la liste selon la zone. */
  const focusModel = (): ListModel => (full() && zone() === "tree" ? tree : samples());
  const cursor = () => focusModel().cursor();
  const selection = () => samples().selection();
  const rowByKey = (key: string | null) => (key?.startsWith("s:") ? samples() : tree).rowByKey(key);
  const visible = () => samples().visible();
  const matches = () => samples().matches();
  const shownTotal = () => tree.shownTotal();
  /** L'arbre de la colonne est en recherche (l'explorer du mode grand ne l'est jamais). */
  const treeSearching = () => !full() && searching();

  /** Recharge ce qui est à l'écran ; `focusKey` : la ligne à garder chargée (le curseur par défaut). */
  async function refresh(focusKey?: string | null) {
    if (!full()) {
      await tree.refresh(focusKey === undefined ? tree.cursor() : focusKey);
      return;
    }
    const sample = !!focusKey?.startsWith("s:");
    await Promise.all([
      tree.refresh(focusKey !== undefined && !sample ? focusKey : tree.cursor()),
      results.refresh(sample ? focusKey : results.cursor()),
    ]);
  }

  /** Scénarios de démo : curseur et sélection, dans les deux listes. */
  const setCursor = (key: string | null) => (key?.startsWith("s:") ? samples() : tree).setCursor(key);
  const setSelection = (keys: string[]) => {
    tree.setSelection(keys);
    results.setSelection(keys);
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

  /** Colonne → bibliothèque : la portée devient le dossier sous le curseur (ou celui du sample sélectionné), et le
   *  sample courant reste sélectionné dans la liste, sans relancer la lecture. */
  async function enterFull() {
    const row = tree.rowByKey(tree.cursor());
    const key = searching() || !row ? null : row.type === "node" ? (row.target ?? row.key) : row.parent;
    if (key && row?.type === "node") knownNames.set(key, row.name);
    const cur = current();
    // Curseurs posés une fois les lignes chargées : les listes, neuves, défilent alors jusqu'à eux.
    batch(() => {
      setLayoutSignal("full");
      setZone("list");
      setScopeSignal(key);
      tree.setCursor(null);
      tree.setSelection([]);
      results.setCursor(null);
      results.setSelection([]);
    });
    const [, fi] = await Promise.all([tree.refresh(key), results.refresh(cur ? `s:${cur.id}` : null)]);
    if (key && tree.rowByKey(key)) tree.setCursor(key);
    const r = fi === null ? undefined : results.rows()[fi];
    if (r?.type === "sample") {
      batch(() => {
        results.setCursor(r.key);
        results.setSelected([r.key]);
        results.setAnchor(r.key);
      });
    }
    focusList("list");
  }

  /** Bibliothèque → colonne : la recherche reste ; l'arbre s'ouvre jusqu'au sample courant, sélectionné. */
  async function enterSide() {
    const row = results.rowByKey(results.cursor());
    const parent = row?.type === "sample" ? row.parent : null;
    if (parent && !searching()) {
      const t: TreeRoot = parent.startsWith("f:") ? "library" : "virtual";
      const up = await api.ancestors(parent);
      setTabSignal(t);
      setExpanded([...new Set([...expandedByTab()[t], ...up, parent])], t);
    }
    batch(() => {
      setLayoutSignal("side");
      setZone("tree");
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
    focusList("tree");
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
  /** Nœud de l'explorer qui devient la portée de la liste (un raccourci vaut son dossier) ; null : tout. */
  function setScope(key: NodeKey | null, name?: string) {
    const k = key?.startsWith("p:") ? `f:${key.slice(2)}` : key;
    if (k && name) knownNames.set(k, name);
    if (k === scope()) return;
    setScopeSignal(k);
    void results.refresh(results.cursor());
  }
  /** Clic dans l'explorer : la ligne devient la portée tout de suite (un saut, dans l'historique). */
  function selectExplorer(key: NodeKey) {
    const r = tree.rowByKey(key);
    if (r?.type !== "node") return;
    const k = r.target ?? key;
    if (k !== scope()) remember();
    select(key, "replace", tree);
    setScope(k, r.name);
  }
  // Flèches dans l'explorer : la portée suit le curseur, une fois qu'il s'arrête.
  let scopeTimer = 0;
  function scheduleScope() {
    clearTimeout(scopeTimer);
    scopeTimer = window.setTimeout(() => {
      const r = tree.rowByKey(tree.cursor());
      if (r?.type === "node") setScope(r.target ?? r.key, r.name);
    }, 150);
  }
  /** Toute la bibliothèque (Échap dans l'explorer, × de la barre de portée). */
  function clearScope() {
    if (scope() === null) return;
    remember();
    tree.setCursor(null);
    setScope(null);
  }
  /** Nom de la portée affiché au-dessus de la liste. */
  const scopeName = () => {
    const k = scope();
    return k === null ? "" : nodeName(k) || knownNames.get(k) || "";
  };
  function setListSort(sort: ListSort) {
    setListSortSignal(sort);
    void results.refresh(results.cursor());
  }
  /** Clic sur un en-tête de colonne : trie par cette colonne, ou inverse le sens si elle trie déjà. */
  function sortBy(column: ListSort["column"]) {
    const cur = listSort();
    setListSort(cur.column === column ? { column, desc: !cur.desc } : { column, desc: false });
  }

  // --- zones du clavier (mode grand) : l'explorer et la liste s'enregistrent pour recevoir le focus
  const zoneEls: Partial<Record<Zone, HTMLElement>> = {};
  const registerZone = (z: Zone, el: HTMLElement) => (zoneEls[z] = el);
  /** Donne le clavier à une zone (en colonne : à l'arbre). */
  function focusList(z: Zone = zone()) {
    const target: Zone = full() ? z : "tree";
    setZone(target);
    zoneEls[target]?.focus();
  }

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
    // Déjà là mais posé par l'analyse : l'ajouter le fait passer aux tags de l'utilisateur.
    const ids = selectedSamples()
      .filter((s) => !s.tags.includes(name) || s.autoTags.includes(name))
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

  /** Rend la main au DAW d'où l'on a sauté dans Crate (Échap dans la recherche vide, glisser terminé). */
  async function returnToDaw(): Promise<boolean> {
    if (!inTauri) return false;
    const { commands } = await import("../api/bindings");
    return commands.returnToDaw();
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

  // --- dossiers (arbre de la colonne, explorer du mode grand)
  /** Ouvert : hors recherche, dans `expanded` ; en recherche, tout sauf ce qu'on a refermé. */
  const isOpen = (key: NodeKey) => (treeSearching() ? !collapsed().includes(key) : expanded().includes(key));

  async function setOpen(key: NodeKey, open: boolean) {
    if (open === isOpen(key)) return;
    if (treeSearching()) {
      const cur = collapsed();
      setCollapsedFor({ line: searchLine(), keys: open ? cur.filter((k) => k !== key) : [...cur, key] });
    } else {
      const cur = expanded();
      setExpanded(open ? [...cur, key] : cur.filter((k) => k !== key));
    }
    await tree.refresh();
  }

  const toggleNode = (key: NodeKey) => setOpen(key, !isOpen(key));

  /** ⌘← / ⌘→ : referme tous les dossiers de l'onglet ; le curseur remonte sur l'élément de premier niveau qui le contenait. */
  async function collapseAll() {
    if (full()) setZone("tree");
    // Remonte par les lignes chargées (les parents sont au-dessus, en général déjà chargés).
    let top: string | null = tree.cursor();
    for (let r = tree.rowByKey(top); r?.parent; r = tree.rowByKey(r.parent)) top = r.parent;
    if (treeSearching()) {
      // En recherche, on referme les nœuds de premier niveau, page par page : une fois refermés, ils tiennent en haut.
      for (;;) {
        await tree.ensureRange(0, Math.min(tree.shownTotal(), PAGE));
        const open = tree.rows().flatMap((r) => (r?.type === "node" && r.depth === 0 && r.open ? [r.key] : []));
        if (!open.length) break;
        setCollapsedFor({ line: searchLine(), keys: [...new Set([...collapsed(), ...open])] });
        await tree.refresh();
      }
    } else {
      setExpanded([]);
      await tree.refresh();
    }
    if (top && tree.indexOf(top) < 0) top = (await api.ancestors(top))[0] ?? null;
    if (top && tree.indexOf(top) >= 0) return select(top, "replace", tree);
    if (tree.shownTotal()) {
      await tree.ensureRange(0, 1);
      const first = tree.rows()[0];
      if (first) select(first.key, "replace", tree);
    }
  }

  // --- sélection : un sample dans la liste qui les porte (arbre en colonne, liste en mode grand), ou un nœud de
  // l'arbre / de l'explorer (curseur seulement)
  function select(key: string, mode: SelectMode = "replace", m: ListModel = key.startsWith("s:") ? samples() : tree) {
    const i = m.indexOf(key);
    const row = i < 0 ? undefined : m.rows()[i];
    if (!row) return;
    m.setCursor(key);
    if (row.type === "node") {
      // En mode grand, les samples sélectionnés sont dans la liste : l'explorer n'y touche pas.
      if (m === samples()) m.setSelected([]);
      return;
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
    if (m === tree && treeSearching()) {
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
    if (m === tree && full()) scheduleScope();
  }

  /** Sélectionne une ligne de l'arbre qui n'est peut-être pas chargée (parent lointain, saut). */
  async function selectKey(key: string) {
    if ((await tree.locate(key)) >= 0) select(key, "replace", tree);
  }

  /** → : ouvre le dossier sélectionné (le curseur reste dessus) ; un raccourci y saute. Rien sur un sample. En mode
   *  grand, sur un dossier ouvert (ou sans sous-dossier), passe à la liste. */
  async function right() {
    if (full() && zone() === "list") return;
    const row = tree.rowByKey(tree.cursor());
    if (!row) return move(0);
    if (row.type === "sample") return;
    if (row.target) return full() ? focusList("list") : jumpTo(row.target);
    if (full() && (row.open || row.leaf)) return focusList("list");
    if (!row.open) return setOpen(row.key, true);
  }

  /** ← : ferme le dossier sélectionné ; sur un sample ou un dossier fermé, ferme son parent et le sélectionne. En mode
   *  grand, depuis la liste, revient à l'explorer. */
  async function left() {
    if (full() && zone() === "list") return focusList("tree");
    const row = tree.rowByKey(tree.cursor());
    if (!row) return;
    if (row.type === "node" && row.open) return setOpen(row.key, false);
    if (!row.parent) return;
    const parent = row.parent;
    await setOpen(parent, false);
    await selectKey(parent);
    if (full()) scheduleScope();
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
    cursor: string | null; // arbre, ou explorer en mode grand
    scope: NodeKey | null; // mode grand : portée de la liste…
    listCursor: string | null; // … et son curseur
  }
  const HISTORY_MAX = 50;
  const [past, setPast] = createSignal<Snapshot[]>([]);
  const [future, setFuture] = createSignal<Snapshot[]>([]);
  const snapshot = (): Snapshot => ({
    tab: tab(),
    chips: chips(),
    draft: draft(),
    expanded: expandedByTab(),
    cursor: tree.cursor(),
    scope: scope(),
    listCursor: results.cursor(),
  });
  const same = (a: Snapshot, b: Snapshot) =>
    a.tab === b.tab && a.draft === b.draft && a.cursor === b.cursor && a.scope === b.scope && a.listCursor === b.listCursor &&
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
      setScopeSignal(snap.scope);
      tree.setCursor(snap.cursor);
      results.setCursor(snap.listCursor);
      setSelection([]);
    });
    await (full() ? Promise.all([tree.refresh(snap.cursor), results.refresh(snap.listCursor)]) : tree.refresh(snap.cursor));
    if (full() && !tree.rowByKey(snap.cursor)) tree.setCursor(null);
    // Curseur seulement (pas de lecture auto) ; un sample redevient la sélection.
    const m = samples();
    const key = full() ? snap.listCursor : snap.cursor;
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

  /** Raccourci : saute au dossier source visé, recherche vidée, parents et dossier ouverts. */
  async function jumpTo(target: NodeKey) {
    remember();
    const parents = await api.ancestors(target);
    batch(() => {
      closeOverlays();
      setView("browser");
      setTabSignal(target.startsWith("f:") ? "library" : "virtual");
      setChips([]);
      setDraft("");
      setExpanded([...new Set([...expanded(), ...parents, target])]);
      if (full()) setScopeSignal(target);
    });
    await refresh(target);
    select(target, "replace", tree);
    // Mode grand : le dossier visé devient la portée de la liste.
    const r = tree.rowByKey(target);
    if (full() && r?.type === "node") knownNames.set(target, r.name);
  }

  // --- onglets
  async function switchTab(t: TreeRoot) {
    if (t === tab()) return;
    remember();
    batch(() => {
      closeOverlays();
      setTabSignal(t);
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

  /** Ouvre l'onglet Virtuels avec ces nœuds dépliés, puis sélectionne `key` (et le renomme si demandé). */
  async function revealVirtual(key: NodeKey, open: NodeKey[], rename = false) {
    remember();
    setTabSignal("virtual");
    setView("browser");
    setExpanded([...new Set([...expandedByTab().virtual, ...open])], "virtual");
    // Mode grand : la nouvelle collection (ou le nouveau dossier) devient aussi la portée de la liste.
    if (full()) setScopeSignal(key);
    await Promise.all([refresh(key), reloadLibrary()]);
    select(key, "replace", tree);
    if (rename) setRenamingKey(key);
  }

  // --- collections (à plat) et recherche enregistrée
  function openSaveSearch() {
    if (!searchLine() && !(full() && scope())) return;
    closeOverlays();
    setSaving(queryLine() || scopeName());
  }

  /** La portée du mode grand, écrite comme un filtre : la collection smart retrouve la même liste. */
  async function scopeFilter(): Promise<string> {
    const k = full() ? scope() : null;
    if (!k) return "";
    if (k === "c:fav") return "is:fav";
    if (k === "g:collections") return "is:collection";
    if (k.startsWith("c:") || k.startsWith("v:")) return `in:"${nodeName(k)}"`;
    // Dossier source : son chemin (avec la barre finale, pour ne pas prendre « Drums 2 » pour « Drums »).
    const path = await api.nodePath(k);
    return path ? `in:"${path.replace(/\/+$/, "")}/"` : "";
  }

  async function saveSearch(name: string) {
    const query = [await scopeFilter(), searchLine()].filter(Boolean).join(" ");
    setSaving(null);
    if (!name.trim() || !query) return;
    const c = await api.createCollection(name.trim(), query);
    batch(() => {
      setChips([]);
      setDraft("");
    });
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
    if (tree.cursor() === key) tree.setCursor(null);
    if (scope() === key) setScopeSignal(null);
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

  /** Vrai si `target` peut recevoir ce qui est glissé (samples ou dossier virtuel). */
  function canDrop(target: NodeKey): boolean {
    const dragged = draggingKey();
    if (!dragged) return false;
    if (dragged.startsWith("v:")) return (target === "root" || target.startsWith("v:")) && target !== dragged;
    if (target === "c:fav" || target.startsWith("v:")) return true;
    return target.startsWith("c:") && library()?.collections.find((c) => c.id === nodeId(target))?.kind === "manual";
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
      if (target !== "root") setExpanded([...new Set([...expanded(), target])]);
      await Promise.all([refresh(), reloadLibrary()]);
      return;
    }
    await addSelectionTo(target);
  }

  /** Déplace un dossier virtuel sous un autre (null = racine) : le pendant clavier du glisser. */
  async function moveVirtualFolderTo(key: NodeKey, parent: NodeKey | null) {
    await api.moveVirtualFolder(nodeId(key), parent === null ? null : nodeId(parent));
    if (parent !== null) setExpanded([...new Set([...expanded(), parent])]);
    tree.setCursor(key);
    await Promise.all([refresh(key), reloadLibrary()]);
  }

  async function addSelectionTo(target: NodeKey) {
    const ids = selectedSamples().map((s) => s.id);
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

  async function removeSource(id: number) {
    await api.removeSource(id);
    if (scope() === `f:${id}`) setScopeSignal(null);
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
        setTabSignal("library");
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
    sideFrame: Frame | null;
    explorerWidth: number | null;
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
      const sorts = ["name", "bpm", "key", "duration", "format", "tags"];
      if (p.listSort && sorts.includes(p.listSort.column)) setListSortSignal({ column: p.listSort.column, desc: !!p.listSort.desc });
      const f = p.sideFrame;
      if (f && [f.x, f.y, f.w, f.h].every((v) => typeof v === "number" && Number.isFinite(v))) setSideFrame(f);
      if (typeof p.explorerWidth === "number" && Number.isFinite(p.explorerWidth)) setExplorerWidth(p.explorerWidth);
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
      sideFrame: sideFrame(),
      explorerWidth: explorerWidth(),
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
    tree, results, zone, setZone, explorerWidth, setExplorerWidth, focusList, registerZone, scope, scopeName, setScope, selectExplorer, clearScope, listSort, sortBy,
    flatResults, setFlatResults, shuffle, reshuffle, waveformFor, flattened, flatten, clearFilters, fontSize, setFontSize, colors, colorOverrides, setColor, resetColors, dawShortcut, setDawShortcut, returnToDaw, accessibility, checkAccessibility, openAccessibilitySettings,
    tab, switchTab, nodeName, newVirtualFolder, renameNode, deleteNode, togglePin, canDrop, dropOn, moveVirtualFolderTo, addSelectionTo,
    removeSelectionFrom, commit, openCommit, setCommitOptions, setCommitDestination, runCommit, closeCommit, setTabSignal,
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
