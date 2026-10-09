// État de l'app (signaux Solid). Toute donnée vient de `api` ; ici on ne garde que l'état d'UI.

import { batch, createRoot, createSignal } from "solid-js";
import { api, type Library, type NodeKey, type Sample, type SampleId, type Source, type TreeRow } from "../api";
import { isChip } from "../lib/query";

export type Density = "compact" | "wave";
export type ThemePref = "dark" | "light" | "system";

export interface MenuState {
  x: number;
  y: number;
  rowKey: string;
}

function createAppState() {
  // --- données reçues du backend
  const [library, setLibrary] = createSignal<Library | null>(null);
  const [rows, setRows] = createSignal<TreeRow[]>([]);
  const [matches, setMatches] = createSignal(0);

  // --- recherche
  const [chips, setChips] = createSignal<string[]>([]);
  const [draft, setDraft] = createSignal("");

  // --- arbre / sélection / lecture
  const [expanded, setExpanded] = createSignal<NodeKey[]>([]);
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
  const [view, setView] = createSignal<"browser" | "settings">("browser");
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
    const page = await api.tree({ query: searchLine(), expanded: expanded(), offset: 0, limit: 2000 });
    if (id !== reqId) return; // requête périmée
    batch(() => {
      setRows(page.rows);
      setMatches(page.matches);
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
    if (row?.type === "node") toggleNode(row.key);
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

  // --- collections
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
      setExpanded([...new Set([...expanded(), "g:collections"])]);
    });
    await Promise.all([refresh(), reloadLibrary()]);
    select(`c:${c.id}`);
  }

  /** Nouvelle collection manuelle, aussitôt en renommage. */
  async function newCollection() {
    const c = await api.createCollection("Nouvelle collection");
    setExpanded([...new Set([...expanded(), "g:collections"])]);
    await Promise.all([refresh(), reloadLibrary()]);
    select(`c:${c.id}`);
    setRenamingKey(`c:${c.id}`);
  }

  async function renameCollection(key: NodeKey, name: string) {
    setRenamingKey(null);
    if (name.trim()) await api.renameCollection(+key.slice(2), name.trim());
    await Promise.all([refresh(), reloadLibrary()]);
  }

  async function deleteCollection(key: NodeKey) {
    await api.deleteCollection(+key.slice(2));
    if (cursor() === key) setCursor(null);
    await Promise.all([refresh(), reloadLibrary()]);
  }

  async function dropOnCollection(key: NodeKey) {
    const ids = selectedSamples().map((s) => s.id);
    batch(() => {
      setDropTarget(null);
      setDraggingKey(null);
    });
    if (!ids.length) return;
    await api.addToCollection(+key.slice(2), ids);
    await refresh();
  }

  async function removeSource(id: number) {
    await api.removeSource(id);
    await Promise.all([refresh(), reloadLibrary()]);
  }

  function openMenu(x: number, y: number, rowKey: string) {
    closeOverlays();
    const row = rowByKey(rowKey);
    // Clic droit hors sélection : la ligne devient la sélection, comme dans le Finder.
    if (row && !(row.type === "sample" && selection().includes(rowKey))) select(rowKey);
    setMenu({ x, y, rowKey });
  }

  return {
    view, setView, tagging, setTagging, saving, setSaving, menu, setMenu, renamingKey, setRenamingKey,
    sources, alwaysOnTop, setAlwaysOnTop, themePref, selectedSamples, closeOverlays, openTagging, toggleTag,
    openSaveSearch, saveSearch, newCollection, renameCollection, deleteCollection, dropOnCollection, removeSource, openMenu,
    library, rows, visible, matches, chips, draft, expanded, cursor, selection, current, playingId, progress,
    autoPlay, listFocused, dropTarget, draggingKey, empty, scan, theme, width, density, grid, queryLine, searching,
    setAutoPlay, setListFocused, setDropTarget, setDraggingKey, setEmpty, setScan, setVisibleLimit, setTheme,
    setWidth, setDensity, setGrid, setChips, setDraft, setSelection, setCursor, setCurrent, setExpanded,
    refresh, reloadLibrary, rowByKey, setQueryDraft, removeChip, editChip, clearQuery, setOpen, toggleNode,
    select, move, right, left, activate, play, stop, togglePlay,
  };
}

export const app = createRoot(createAppState);
export type AppState = typeof app;
