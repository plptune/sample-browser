// État de l'app (signaux Solid). Toute donnée vient de `api` ; ici on ne garde que l'état d'UI.

import { batch, createRoot, createSignal } from "solid-js";
import { api, type Library, type Sample, type SampleId, type Scope, type SortKey } from "../api";
import { isChip } from "../lib/query";

export type Density = "compact" | "wave";

function createAppState() {
  // --- données reçues du backend
  const [library, setLibrary] = createSignal<Library | null>(null);
  const [results, setResults] = createSignal<Sample[]>([]);
  const [total, setTotal] = createSignal(0);

  // --- recherche
  const [scope, setScope] = createSignal<Scope>({ type: "all" });
  const [chips, setChips] = createSignal<string[]>([]);
  const [draft, setDraft] = createSignal("");
  const [sort, setSort] = createSignal<SortKey>("name");

  // --- sélection / lecture
  const [selection, setSelection] = createSignal<SampleId[]>([]);
  const [cursor, setCursor] = createSignal<SampleId | null>(null);
  const [anchor, setAnchor] = createSignal<SampleId | null>(null);
  const [playingId, setPlayingId] = createSignal<SampleId | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [autoPlay, setAutoPlay] = createSignal(false);
  const [listFocused, setListFocused] = createSignal(false);

  // --- sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [openSections, setOpenSections] = createSignal<Record<string, boolean>>({
    library: true,
    collections: true,
    sources: true,
  });
  const [expanded, setExpanded] = createSignal<number[]>([]);
  const [dropTarget, setDropTarget] = createSignal<number | null>(null);
  const [draggingId, setDraggingId] = createSignal<SampleId | null>(null);
  const [renamingId, setRenamingId] = createSignal<number | null>(null);

  // --- états globaux simulés
  const [empty, setEmpty] = createSignal(false); // premier lancement
  const [scan, setScan] = createSignal<{ done: number; total: number; folder: string } | null>(null);
  const [visibleLimit, setVisibleLimit] = createSignal<number | null>(null); // liste qui se remplit pendant le scan

  // --- réglages d'affichage (démo)
  const [theme, setTheme] = createSignal<"dark" | "light">("dark");
  const [width, setWidth] = createSignal(320);
  const [density, setDensity] = createSignal<Density>("compact");
  const [grid, setGrid] = createSignal(false);

  const queryLine = () => [...chips(), draft()].join(" ").trim();
  // Les tokens spéciaux encore en cours de frappe (#ta, bpm:1…) ne filtrent pas : seul le texte libre filtre en direct.
  const searchLine = () => [...chips(), ...draft().split(/\s+/).filter((t) => t && !isChip(t))].join(" ");

  let reqId = 0;
  async function refresh() {
    const id = ++reqId;
    const page = await api.search({ scope: scope(), query: searchLine(), sort: sort(), offset: 0, limit: 500 });
    if (id !== reqId) return; // requête périmée
    batch(() => {
      setResults(page.items);
      setTotal(page.total);
    });
  }

  async function reloadLibrary() {
    setLibrary(await api.library());
  }

  const visible = () => {
    const lim = visibleLimit();
    const r = results();
    return lim === null ? r : r.slice(0, lim);
  };

  const byId = (id: SampleId | null) => (id === null ? undefined : results().find((s) => s.id === id));

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

  function goTo(s: Scope) {
    batch(() => {
      setScope(s);
      setSelection([]);
      setCursor(null);
    });
    refresh();
  }

  // --- sélection
  function select(id: SampleId, mode: "replace" | "toggle" | "range" = "replace") {
    const list = visible();
    if (mode === "toggle") {
      const cur = selection();
      setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
      setAnchor(id);
    } else if (mode === "range" && anchor() !== null) {
      const a = list.findIndex((s) => s.id === anchor());
      const b = list.findIndex((s) => s.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelection(list.slice(lo, hi + 1).map((s) => s.id));
    } else {
      setSelection([id]);
      setAnchor(id);
    }
    setCursor(id);
    if (autoPlay() && mode === "replace") play(id);
  }

  function move(delta: number, extend = false) {
    const list = visible();
    if (!list.length) return;
    const i = list.findIndex((s) => s.id === cursor());
    const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + delta))];
    select(next.id, extend ? "range" : "replace");
  }

  // --- lecture factice (aucun son)
  let raf = 0;
  function play(id: SampleId) {
    cancelAnimationFrame(raf);
    const s = byId(id);
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
    const id = cursor();
    if (id === null) return;
    playingId() === id ? stop() : play(id);
  }

  /** Fige la lecture à une position donnée (captures / galerie). */
  function freezePlayback(id: SampleId, p: number) {
    cancelAnimationFrame(raf);
    batch(() => {
      setPlayingId(id);
      setProgress(p);
    });
  }

  // --- actions sur la sélection
  async function renameCollection(id: number, name: string) {
    setRenamingId(null);
    if (name.trim()) await api.renameCollection(id, name.trim());
    await reloadLibrary();
  }

  function toggleSection(key: string) {
    setOpenSections({ ...openSections(), [key]: !openSections()[key] });
  }

  function toggleFolder(id: number) {
    const cur = expanded();
    setExpanded(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  return {
    library, results, visible, total, scope, chips, draft, sort, selection, cursor, playingId, progress,
    autoPlay, listFocused, sidebarCollapsed, openSections, expanded, dropTarget, draggingId, renamingId,
    empty, scan, theme, width, density, grid, queryLine,
    setSort, setAutoPlay, setListFocused, setSidebarCollapsed, setOpenSections, setExpanded, setDropTarget,
    setDraggingId, setRenamingId, setEmpty, setScan, setVisibleLimit, setTheme, setWidth, setDensity, setGrid,
    setChips, setDraft, setSelection, setCursor,
    refresh, reloadLibrary, byId, setQueryDraft, removeChip, editChip, clearQuery, goTo, select, move,
    play, stop, togglePlay, freezePlayback, renameCollection, toggleSection, toggleFolder,
  };
}

export const app = createRoot(createAppState);
export type AppState = typeof app;
