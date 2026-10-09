// État de l'app (signaux Solid). Toute donnée vient de `api` ; ici on ne garde que l'état d'UI.

import { batch, createRoot, createSignal } from "solid-js";
import {
  api, type CommitOptions, type CommitPlan, type CommitResult, type Library, type NodeKey, type Sample, type SampleId, type Source,
  type TreeRoot, type TreeRow,
} from "../api";
import { isChip } from "../lib/query";

export type Density = "compact" | "wave";
export type ThemePref = "dark" | "light" | "system";

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
}

function createAppState() {
  // --- données reçues du backend
  const [library, setLibrary] = createSignal<Library | null>(null);
  const [rows, setRows] = createSignal<TreeRow[]>([]);
  const [matches, setMatches] = createSignal(0);

  // --- recherche
  const [chips, setChips] = createSignal<string[]>([]);
  const [draft, setDraft] = createSignal("");

  // --- onglets : « Bibliothèque » (sources + épinglés) et « Virtuels » (favoris, collections, dossiers virtuels)
  const [tab, setTabSignal] = createSignal<TreeRoot>("library");
  const [expandedByTab, setExpandedByTab] = createSignal<Record<TreeRoot, NodeKey[]>>({ library: [], virtual: [] });
  const expanded = () => expandedByTab()[tab()];
  const setExpanded = (keys: NodeKey[], t: TreeRoot = tab()) => setExpandedByTab({ ...expandedByTab(), [t]: keys });

  // --- arbre / sélection / lecture
  const [cursor, setCursor] = createSignal<string | null>(null); // clé de ligne
  const [selection, setSelection] = createSignal<string[]>([]); // clés de lignes sample
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const [current, setCurrent] = createSignal<Sample | null>(null); // dernier sample sélectionné (tiroir)
  const [playingId, setPlayingId] = createSignal<SampleId | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [autoPlay, setAutoPlay] = createSignal(false);
  const [listFocused, setListFocused] = createSignal(false);
  const [dropTarget, setDropTarget] = createSignal<NodeKey | null>(null);
  const [draggingKey, setDraggingKey] = createSignal<string | null>(null);

  // --- états globaux simulés
  const [empty, setEmpty] = createSignal(false); // premier lancement
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
  const [density, setDensity] = createSignal<Density>("compact");
  const [grid, setGrid] = createSignal(false);

  const queryLine = () => [...chips(), draft()].join(" ").trim();
  // Les tokens spéciaux encore en cours de frappe (#ta, bpm:1…) ne filtrent pas : seul le texte libre filtre en direct.
  const searchLine = () => [...chips(), ...draft().split(/\s+/).filter((t) => t && !isChip(t))].join(" ");
  const searching = () => searchLine() !== "";

  let reqId = 0;
  async function refresh() {
    const id = ++reqId;
    const page = await api.tree({ root: tab(), query: searchLine(), expanded: expanded(), offset: 0, limit: 2000 });
    if (id !== reqId) return; // requête périmée
    batch(() => {
      setRows(page.rows);
      setMatches(page.matches);
      // Le tiroir garde le sample courant à jour (favori, tags) s'il est encore visible.
      const cur = current();
      const fresh = cur && page.rows.find((r) => r.type === "sample" && r.sample.id === cur.id);
      if (fresh && fresh.type === "sample") setCurrent(fresh.sample);
    });
  }

  async function reloadLibrary() {
    const [lib, src] = await Promise.all([api.library(), api.sources()]);
    batch(() => {
      setLibrary(lib);
      setSources(src);
    });
  }

  const visible = () => {
    const lim = visibleLimit();
    const r = rows();
    return lim === null ? r : r.slice(0, lim);
  };

  const rowByKey = (key: string | null) => (key === null ? undefined : visible().find((r) => r.key === key));
  const sampleById = (id: SampleId | null) => {
    if (id === null) return undefined;
    const r = rows().find((r) => r.type === "sample" && r.sample.id === id);
    return r?.type === "sample" ? r.sample : undefined;
  };

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

  // --- dossiers
  async function setOpen(key: NodeKey, open: boolean) {
    if (searching()) return; // en recherche, l'arbre est entièrement ouvert
    const cur = expanded();
    if (open === cur.includes(key)) return;
    setExpanded(open ? [...cur, key] : cur.filter((k) => k !== key));
    await refresh();
  }

  const toggleNode = (key: NodeKey) => setOpen(key, !expanded().includes(key));

  // --- sélection
  function select(key: string, mode: "replace" | "toggle" | "range" = "replace") {
    const list = visible();
    const row = list.find((r) => r.key === key);
    if (!row) return;
    setCursor(key);
    if (row.type === "node") {
      setSelection([]);
      return;
    }
    if (mode === "toggle") {
      const cur = selection();
      setSelection(cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]);
      setAnchor(key);
    } else if (mode === "range" && anchor() !== null) {
      const a = list.findIndex((r) => r.key === anchor());
      const b = list.findIndex((r) => r.key === key);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelection(list.slice(lo, hi + 1).filter((r) => r.type === "sample").map((r) => r.key));
    } else {
      setSelection([key]);
      setAnchor(key);
    }
    setCurrent(row.sample);
    if (autoPlay() && mode === "replace") play(row.sample.id);
  }

  function move(delta: number, extend = false) {
    const list = visible();
    if (!list.length) return;
    const i = list.findIndex((r) => r.key === cursor());
    const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + delta))];
    select(next.key, extend ? "range" : "replace");
  }

  /** → : ouvre un dossier fermé, entre dans un dossier ouvert, lit un sample. */
  async function right() {
    const row = rowByKey(cursor());
    if (!row) return move(0);
    if (row.type === "sample") return play(row.sample.id);
    if (row.target) return jumpTo(row.target);
    if (!row.open) return setOpen(row.key, true);
    move(1);
  }

  /** ← : ferme un dossier ouvert, sinon remonte au dossier parent. */
  async function left() {
    const row = rowByKey(cursor());
    if (!row) return;
    if (row.type === "node" && row.open && !searching()) return setOpen(row.key, false);
    if (row.parent && rowByKey(row.parent)) select(row.parent);
  }

  function activate() {
    const row = rowByKey(cursor());
    if (row?.type === "node") row.target ? jumpTo(row.target) : toggleNode(row.key);
    else togglePlay();
  }

  // --- lecture factice (aucun son)
  let raf = 0;
  function play(id: SampleId) {
    cancelAnimationFrame(raf);
    const s = sampleById(id);
    if (!s || s.missing) return stop();
    const dur = Math.max(s.durationMs, 600);
    const t0 = performance.now();
    batch(() => {
      setPlayingId(id);
      setProgress(0);
    });
    const tick = (now: number) => {
      const p = (now - t0) / dur;
      if (p >= 1) return stop();
      setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(raf);
    batch(() => {
      setPlayingId(null);
      setProgress(0);
    });
  }

  function togglePlay() {
    const s = current();
    if (!s) return;
    playingId() === s.id ? stop() : play(s.id);
  }

  // --- sélection effective : la multi-sélection, sinon la ligne sous le curseur
  const selectedSamples = (): Sample[] => {
    const keys = selection().length ? selection() : cursor() ? [cursor()!] : [];
    return keys.map(rowByKey).flatMap((r) => (r?.type === "sample" ? [r.sample] : []));
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
    cursor: string | null;
  }
  const HISTORY_MAX = 50;
  const [past, setPast] = createSignal<Snapshot[]>([]);
  const [future, setFuture] = createSignal<Snapshot[]>([]);
  const snapshot = (): Snapshot => ({ tab: tab(), chips: chips(), draft: draft(), expanded: expandedByTab(), cursor: cursor() });
  const same = (a: Snapshot, b: Snapshot) =>
    a.tab === b.tab && a.draft === b.draft && a.cursor === b.cursor && a.chips.join("\n") === b.chips.join("\n") &&
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
      setCursor(snap.cursor);
      setSelection([]);
    });
    await refresh();
    // Curseur seulement (pas de lecture auto) ; un sample redevient la sélection.
    const row = rowByKey(snap.cursor);
    if (!row) setCursor(null);
    else if (row.type === "sample") {
      batch(() => {
        setSelection([row.key]);
        setAnchor(row.key);
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
    });
    await refresh();
    select(target);
  }

  // --- onglets
  async function switchTab(t: TreeRoot) {
    if (t === tab()) return;
    remember();
    batch(() => {
      closeOverlays();
      setTabSignal(t);
      setView("browser");
      setSelection([]);
      setCursor(null);
    });
    await refresh();
  }

  const nodeId = (key: NodeKey) => +key.slice(2);
  const nodeName = (key: NodeKey) => {
    const lib = library();
    if (key === "c:fav") return "Favoris";
    if (key.startsWith("c:")) return lib?.collections.find((c) => c.id === nodeId(key))?.name ?? "";
    if (key.startsWith("v:")) return lib?.virtualFolders.find((f) => f.id === nodeId(key))?.name ?? "";
    return "";
  };

  /** Ouvre l'onglet Virtuels avec ces nœuds dépliés, puis sélectionne `key` (et le renomme si demandé). */
  async function revealVirtual(key: NodeKey, open: NodeKey[], rename = false) {
    remember();
    setTabSignal("virtual");
    setView("browser");
    setExpanded([...new Set([...expandedByTab().virtual, ...open])], "virtual");
    await Promise.all([refresh(), reloadLibrary()]);
    select(key);
    if (rename) setRenamingKey(key);
  }

  // --- collections (à plat) et recherche enregistrée
  function openSaveSearch() {
    if (!searchLine()) return;
    closeOverlays();
    setSaving(queryLine());
  }

  async function saveSearch(name: string) {
    const query = searchLine();
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
    const c = await api.createCollection("Nouvelle collection");
    await revealVirtual(`c:${c.id}`, ["g:collections"], true);
  }

  // --- dossiers virtuels (arborescence)
  async function newVirtualFolder(parent: NodeKey | null = null) {
    const f = await api.createVirtualFolder("Nouveau dossier", parent ? nodeId(parent) : null);
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
    if (cursor() === key) setCursor(null);
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

  async function addSelectionTo(target: NodeKey) {
    const ids = selectedSamples().map((s) => s.id);
    if (!ids.length) return;
    if (target === "c:fav") await api.setFavorite(ids, true);
    else if (target.startsWith("c:")) await api.addToCollection(nodeId(target), ids);
    else if (target.startsWith("v:")) await api.addToVirtualFolder(nodeId(target), ids);
    await refresh();
  }

  /** Retire la sélection de la collection / du dossier virtuel qui la contient (jamais du disque). */
  async function removeSelectionFrom(parent: NodeKey) {
    const ids = selectedSamples().map((s) => s.id);
    if (parent === "c:fav") await api.setFavorite(ids, false);
    else if (parent.startsWith("c:")) await api.removeFromCollection(nodeId(parent), ids);
    else if (parent.startsWith("v:")) await api.removeFromVirtualFolder(nodeId(parent), ids);
    setSelection([]);
    await refresh();
  }

  // --- « Créer un vrai dossier » (copie, jamais de déplacement)
  async function openCommit(key: NodeKey) {
    closeOverlays();
    const name = nodeName(key);
    const flat = !key.startsWith("v:");
    const options = { keepHierarchy: !flat, addAsSource: false };
    setCommit({ key, name, flat, destination: `~/Desktop/${name}`, options, plan: null, status: "idle", progress: 0, result: null });
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

  const setCommitDestination = (destination: string) => setCommit((c) => (c ? { ...c, destination } : c));

  async function runCommit() {
    const c = commit();
    if (!c || c.status !== "idle" || !c.destination.trim()) return;
    setCommit({ ...c, status: "running", progress: 0 });
    // Progression simulée (phases 0 / 1). Phase 5 : événements de copie envoyés par Rust.
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 1200);
        setCommit((x) => (x ? { ...x, progress: p } : x));
        p < 1 ? requestAnimationFrame(tick) : done();
      };
      requestAnimationFrame(tick);
    });
    const result = await api.commitToFolder(c.key, c.destination.trim(), c.options);
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
    await Promise.all([refresh(), reloadLibrary()]);
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
    tab, switchTab, nodeName, newVirtualFolder, renameNode, deleteNode, togglePin, canDrop, dropOn, addSelectionTo,
    removeSelectionFrom, commit, openCommit, setCommitOptions, setCommitDestination, runCommit, closeCommit, setTabSignal,
    library, rows, visible, matches, chips, draft, expanded, cursor, selection, current, playingId, progress,
    autoPlay, listFocused, dropTarget, draggingKey, empty, scan, theme, width, density, grid, queryLine, searching,
    setAutoPlay, setListFocused, setDropTarget, setDraggingKey, setEmpty, setScan, setVisibleLimit, setTheme,
    setWidth, setDensity, setGrid, setChips, setDraft, setSelection, setCursor, setCurrent, setExpanded,
    refresh, reloadLibrary, rowByKey, setQueryDraft, removeChip, editChip, clearQuery, setOpen, toggleNode,
    select, move, right, left, activate, play, stop, togglePlay,
    jumpTo, back, forward, clearHistory, canBack, canForward,
  };
}

export const app = createRoot(createAppState);
export type AppState = typeof app;
