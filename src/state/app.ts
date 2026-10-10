// État de l'app (signaux Solid). Toute donnée vient de `api` ; ici on ne garde que l'état d'UI.

import { batch, createEffect, createRoot, createSignal, on } from "solid-js";
import {
  type AnalysisStatus,
  api, type CommitOptions, type CommitPlan, type CommitResult, type Library, type NodeKey, type Sample, type SampleId, type ScanStatus,
  type Source,
  type TreeRoot, type TreeRow,
} from "../api";
import type { DawShortcutConfig } from "../api/bindings";
import { inTauri } from "../lib/env";
import { DEFAULT_DAW_SHORTCUT } from "../lib/shortcut";
import { isChip } from "../lib/query";

/** Colonne étroite à côté du DAW, ou grande fenêtre (arbre large + inspecteur). */
export type Layout = "side" | "full";

export type Density = "compact" | "wave";
export type ThemePref = "dark" | "light" | "system";
/** Taille du texte (Réglages › Apparence) : S, M (défaut), L. */
export type FontSize = "sm" | "base" | "lg";
/** Couleurs de base modifiables, par thème ; absentes = celles du design system. */
export type ColorRole = "accent" | "primary" | "bg";
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
  // Lignes de l'arbre chargées par pages : tableau creux de `total` cases (undefined = pas encore chargée).
  const [rows, setRows] = createSignal<(TreeRow | undefined)[]>([]);
  const [total, setTotal] = createSignal(0);
  const [matches, setMatches] = createSignal(0);
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

  // --- arbre / sélection / lecture
  const [cursor, setCursor] = createSignal<string | null>(null); // clé de ligne
  const [selection, setSelection] = createSignal<string[]>([]); // clés de lignes sample
  const [anchor, setAnchor] = createSignal<string | null>(null);
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

  // --- arbre par pages
  const PAGE = 200;
  const keyIndex = new Map<string, number>(); // clé → position, pour les lignes chargées
  let viewport = { start: 0, end: PAGE }; // lignes à l'écran (virtualiseur)
  let reqId = 0;
  let inFlight = new Set<number>(); // pages demandées pour la requête courante
  let lastSig = "";
  const [scrollReset, setScrollReset] = createSignal(0); // le virtualiseur remonte en haut quand il change

  const baseRequest = () => ({ root: tab(), query: searchLine(), expanded: expanded(), peaks: density() === "wave" });

  function place(arr: (TreeRow | undefined)[], offset: number, page: TreeRow[]) {
    page.forEach((r, i) => {
      arr[offset + i] = r;
      keyIndex.set(r.key, offset + i);
    });
  }

  /** Recharge l'arbre : la page à l'écran et celle de `focusKey` (le curseur par défaut), en un seul échange. */
  async function refresh(focusKey: string | null = cursor()) {
    const id = ++reqId;
    inFlight = new Set();
    const t0 = performance.now();
    const base = baseRequest();
    // Nouvelle recherche ou autre onglet : on repart du haut de l'arbre.
    const sig = `${base.root}\n${base.query}`;
    if (sig !== lastSig) {
      lastSig = sig;
      viewport = { start: 0, end: PAGE };
      setScrollReset((n) => n + 1);
    }
    const first = Math.floor(viewport.start / PAGE);
    // Une page suffit à remplir l'écran (~30 lignes + marge) ; les suivantes arrivent au défilement.
    const page = await api.tree({ ...base, offset: first * PAGE, limit: PAGE, focus: focusKey });
    if (id !== reqId) return; // requête périmée
    const t1 = performance.now();
    keyIndex.clear();
    const arr: (TreeRow | undefined)[] = new Array(page.totalRows);
    place(arr, first * PAGE, page.rows);
    const fi = page.focusIndex ?? null;
    if (fi !== null && arr[fi] === undefined) {
      const at = Math.floor(fi / PAGE) * PAGE;
      const extra = await api.tree({ ...base, offset: at, limit: PAGE });
      if (id !== reqId) return;
      place(arr, at, extra.rows);
    }
    batch(() => {
      setRows(arr);
      setTotal(page.totalRows);
      setMatches(page.matches);
      // Le tiroir et la sélection gardent leurs samples à jour (favori, tags) s'ils sont chargés.
      const cur = current();
      const fresh = cur ? sampleById(cur.id) : undefined;
      if (fresh) setCurrent(fresh);
      for (const k of selData.keys()) {
        const r = rowByKey(k);
        if (r?.type === "sample") selData.set(k, r.sample);
      }
    });
    const t2 = performance.now();
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
  }

  /** Charge les pages qui couvrent [start, end) si besoin (défilement, flèches, ⇧-sélection). */
  async function ensureRange(start: number, end: number) {
    const id = reqId;
    const base = baseRequest();
    const want: number[] = [];
    for (let p = Math.floor(Math.max(0, start) / PAGE); p * PAGE < Math.min(end, total()); p++) {
      if (rows()[p * PAGE] === undefined && !inFlight.has(p)) want.push(p);
    }
    await Promise.all(
      want.map(async (p) => {
        inFlight.add(p);
        const page = await api.tree({ ...base, offset: p * PAGE, limit: PAGE });
        if (id !== reqId) return;
        const arr = rows().slice();
        place(arr, p * PAGE, page.rows);
        setRows(arr);
      }),
    );
  }

  /** Lignes à l'écran, données par le virtualiseur. */
  function setViewRange(start: number, end: number) {
    viewport = { start, end };
    void ensureRange(start, end);
  }

  async function reloadLibrary() {
    const [lib, src] = await Promise.all([api.library(), api.sources()]);
    batch(() => {
      setLibrary(lib);
      setSources(src);
    });
  }

  /** Nombre de lignes affichées (le scénario « Indexation » le limite pour simuler un arbre qui se remplit). */
  const shownTotal = () => {
    const lim = visibleLimit();
    return lim === null ? total() : Math.min(lim, total());
  };
  const rowAt = (i: number) => (i < shownTotal() ? rows()[i] : undefined);
  /** Lignes chargées, dans l'ordre (scénarios de démo, tests). */
  const visible = () => rows().slice(0, shownTotal()).filter((r): r is TreeRow => r !== undefined);

  const indexOf = (key: string | null) => {
    rows(); // dépendance réactive
    const i = key === null ? undefined : keyIndex.get(key);
    return i === undefined || i >= shownTotal() ? -1 : i;
  };
  const rowByKey = (key: string | null) => {
    const i = indexOf(key);
    return i < 0 ? undefined : rows()[i];
  };
  const sampleById = (id: SampleId | null) => {
    if (id === null) return undefined;
    const r = rows().find((r) => r?.type === "sample" && r.sample.id === id);
    if (r?.type === "sample") return r.sample;
    const cur = current();
    return cur?.id === id ? cur : undefined;
  };

  // --- deux modes d'affichage : colonne (à côté du DAW) et grande fenêtre (arbre large + inspecteur).
  // Dans la fenêtre, le mode suit l'état « agrandi » de la fenêtre (bouton vert, double-clic sur la barre titre).
  const [layout, setLayoutSignal] = createSignal<Layout>("side");
  async function syncLayout() {
    if (!inTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    setLayoutSignal((await getCurrentWindow().isMaximized()) ? "full" : "side");
  }
  /** ⌘⇧F ou le bouton de la barre titre : agrandit la fenêtre à l'écran, ou la remet en colonne. */
  async function toggleLayout() {
    closeOverlays();
    if (inTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
      return syncLayout();
    }
    // Prototype : la fausse fenêtre s'élargit.
    const next: Layout = layout() === "full" ? "side" : "full";
    batch(() => {
      setLayoutSignal(next);
      setWidth(next === "full" ? 1200 : 320);
    });
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
    const name = tag.trim();
    const ids = selectedSamples().filter((s) => !s.tags.includes(name)).map((s) => s.id);
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

  // Toujours au premier plan : appliqué à la vraie fenêtre.
  createEffect(
    on(alwaysOnTop, (v) => {
      if (inTauri) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setAlwaysOnTop(v));
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
        if (id === undefined) return setCurrentPeaks([]);
        void api.peaks(id).then((p) => current()?.id === id && setCurrentPeaks(p));
      },
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

  /** ⌘← : referme tous les dossiers de l'onglet ; le curseur remonte sur l'élément de premier niveau qui le contenait. */
  async function collapseAll() {
    if (searching()) return; // en recherche, l'arbre est entièrement ouvert
    // Remonte par les lignes chargées (les parents sont au-dessus, en général déjà chargés).
    let top: string | null = cursor();
    for (let r = rowByKey(top); r?.parent; r = rowByKey(r.parent)) top = r.parent;
    setExpanded([]);
    await refresh();
    if (top && indexOf(top) < 0) top = (await api.ancestors(top))[0] ?? null;
    if (top && indexOf(top) >= 0) return select(top);
    if (shownTotal()) {
      await ensureRange(0, 1);
      const first = rows()[0];
      if (first) select(first.key);
    }
  }

  // --- sélection (les samples sélectionnés sont gardés à part : leurs lignes peuvent sortir des pages chargées)
  const selData = new Map<string, Sample>();

  function setSelected(keys: string[]) {
    selData.clear();
    for (const k of keys) {
      const r = rowByKey(k);
      if (r?.type === "sample") selData.set(k, r.sample);
    }
    setSelection(keys);
  }

  function select(key: string, mode: "replace" | "toggle" | "range" = "replace") {
    const i = indexOf(key);
    const row = i < 0 ? undefined : rows()[i];
    if (!row) return;
    setCursor(key);
    if (row.type === "node") {
      setSelected([]);
      return;
    }
    if (mode === "toggle") {
      const cur = selection();
      const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
      const keep = new Map(selData);
      setSelected(next);
      for (const k of next) if (!selData.has(k) && keep.has(k)) selData.set(k, keep.get(k)!);
      setAnchor(key);
    } else if (mode === "range" && indexOf(anchor()) >= 0) {
      const a = indexOf(anchor());
      const [lo, hi] = a < i ? [a, i] : [i, a];
      const span = rows().slice(lo, hi + 1);
      if (span.some((r) => r === undefined)) {
        // Pages manquantes au milieu : on les charge, puis on reprend.
        void ensureRange(lo, hi + 1).then(() => select(key, "range"));
        return;
      }
      setSelected(span.flatMap((r) => (r?.type === "sample" ? [r.key] : [])));
    } else {
      setSelected([key]);
      setAnchor(key);
    }
    setCurrent(row.sample);
    if (autoPlay() && mode === "replace") play(row.sample.id);
  }

  async function move(delta: number, extend = false) {
    const n = shownTotal();
    if (!n) return;
    const i = indexOf(cursor());
    const next = Math.max(0, Math.min(n - 1, i < 0 ? 0 : i + delta));
    await ensureRange(next, next + 1);
    const r = rows()[next];
    if (r) select(r.key, extend ? "range" : "replace");
  }

  /** Sélectionne une ligne qui n'est peut-être pas chargée (parent lointain, saut). */
  async function selectKey(key: string) {
    if (indexOf(key) < 0) {
      const page = await api.tree({ ...baseRequest(), offset: 0, limit: 0, focus: key });
      const fi = page.focusIndex ?? null;
      if (fi === null) return;
      await ensureRange(fi, fi + 1);
    }
    select(key);
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
    if (row.parent) await selectKey(row.parent);
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
    if (s.error) setNotice("Ce fichier ne peut pas être lu.");
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

  /** ⌘⇧Espace : un sample au hasard parmi les lignes de l'arbre (chargées à la demande). */
  async function playRandom() {
    const n = shownTotal();
    for (let k = 0; k < 40 && n > 0; k++) {
      const i = Math.floor(Math.random() * n);
      await ensureRange(i, i + 1);
      const r = rows()[i];
      if (r?.type === "sample" && !r.sample.missing) {
        select(r.key);
        play(r.sample.id);
        return;
      }
    }
  }

  // --- sélection effective : la multi-sélection, sinon la ligne sous le curseur
  const selectedSamples = (): Sample[] => {
    if (selection().length) return selection().flatMap((k) => (selData.has(k) ? [selData.get(k)!] : []));
    const r = rowByKey(cursor());
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
    await refresh(snap.cursor);
    // Curseur seulement (pas de lecture auto) ; un sample redevient la sélection.
    const row = rowByKey(snap.cursor);
    if (!row) setCursor(null);
    else if (row.type === "sample") {
      batch(() => {
        setSelected([row.key]);
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
    await refresh(target);
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
    await Promise.all([refresh(key), reloadLibrary()]);
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

  /** Déplace un dossier virtuel sous un autre (null = racine) : le pendant clavier du glisser. */
  async function moveVirtualFolderTo(key: NodeKey, parent: NodeKey | null) {
    await api.moveVirtualFolder(nodeId(key), parent === null ? null : nodeId(parent));
    if (parent !== null) setExpanded([...new Set([...expanded(), parent])]);
    setCursor(key);
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
    if (hidden) setSelected([]);
    await Promise.all([refresh(), reloadLibrary()]);
    if (hidden) setNotice(`${ids.length > 1 ? `${ids.length} samples masqués` : "Sample masqué"} : « is:hidden » pour les retrouver.`);
  }

  async function hideFolder(key: NodeKey, hidden: boolean) {
    if (!key.startsWith("f:")) return;
    await api.setFolderHidden(+key.slice(2), hidden);
    await Promise.all([refresh(), reloadLibrary()]);
    if (hidden) setNotice(`Dossier « ${rowByKey(key)?.type === "node" ? (rowByKey(key) as { name: string }).name : ""} » masqué : « is:hidden » pour le retrouver.`);
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
    setSelection([]);
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
      const d = p.dawShortcut;
      if (d && typeof d.enabled === "boolean" && typeof d.shortcut === "string" && Array.isArray(d.apps)) setDawShortcut(d);
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
    // Fenêtre : le mode suit l'état « agrandi » ; relancée en mode grand si on l'avait quittée ainsi.
    if (inTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await syncLayout();
      if (!isDemoMode && savedLayout === "full" && layout() !== "full") await toggleLayout();
      void getCurrentWindow().onResized(() => void syncLayout());
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
    if (!inTauri) return setNotice("« Ouvrir dans le Finder » marche dans l'app Mac, pas dans ce prototype.");
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
    layout, toggleLayout, memberships, removeTag, addTag,
    fontSize, setFontSize, colors, colorOverrides, setColor, resetColors, dawShortcut, setDawShortcut, returnToDaw,
    tab, switchTab, nodeName, newVirtualFolder, renameNode, deleteNode, togglePin, canDrop, dropOn, moveVirtualFolderTo, addSelectionTo,
    removeSelectionFrom, commit, openCommit, setCommitOptions, setCommitDestination, runCommit, closeCommit, setTabSignal,
    library, rows, visible, matches, chips, draft, expanded, cursor, selection, current, playingId, progress,
    autoPlay, listFocused, dropTarget, draggingKey, empty, scan, theme, width, density, grid, queryLine, searching,
    setAutoPlay, setListFocused, setDropTarget, setDraggingKey, setEmpty, setScan, setVisibleLimit, setTheme,
    setWidth, setDensity, setGrid, setChips, setDraft, setSelection, setCursor, setCurrent, setExpanded,
    refresh, reloadLibrary, rowByKey, setQueryDraft, removeChip, editChip, clearQuery, setOpen, toggleNode, collapseAll,
    select, move, right, left, activate, play, stop, togglePlay, selectKey,
    total, shownTotal, rowAt, indexOf, setViewRange, ensureRange, currentPeaks, scrollReset, synonyms, saveSynonyms,
    hideSelection, hideFolder, removeOrHide,
    looping, setLooping, volume, setVolume, stopOnDrag, setStopOnDrag, stopOnBlur, setStopOnBlur, latency, seekTo, nudge, playRandom, analysis, metrics, debug, setDebug,
    jumpTo, back, forward, clearHistory, canBack, canForward,
    demo, notice, setNotice, fileOver, setFileOver, addFolder, refreshSource, start, showInFinder, openFolderInFinder, finderForSelection, chooseCommitParent,
  };
}

export const app = createRoot(createAppState);
export type AppState = typeof app;
