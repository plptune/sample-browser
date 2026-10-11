// Une liste chargée par pages (arbre de la colonne, explorer et liste du mode grand) : lignes, curseur et sélection.
// La logique (lecture auto, portée, recherche) reste dans app.ts ; ici, seulement l'état d'une liste.

import { batch, createSignal } from "solid-js";
import type { Sample, SampleId, TreePage, TreeRow } from "../api";

export const PAGE = 200;

/** Temps d'une requête vue de l'UI (overlay ⌥⌘D). */
export interface PageTiming {
  page: TreePage;
  t0: number;
  t1: number;
  t2: number;
}

export function createListModel<R extends object>(o: {
  /** Requête de base, lue au moment de chaque chargement. */
  request: () => R;
  fetch: (req: R & { offset: number; limit: number; focus?: string | null }) => Promise<TreePage>;
  /** Change (autre recherche, autre onglet…) : la liste repart du haut. */
  signature: (req: R) => string;
  /** Le scénario « Indexation » limite les lignes affichées. */
  visibleLimit?: () => number | null;
  /** Dans le même lot que les nouvelles lignes (tiroir et sélection à jour). */
  onRefreshed?: () => void;
  onLoaded?: (t: PageTiming) => void;
}) {
  // Lignes chargées par pages : tableau creux de `total` cases (undefined = pas encore chargée).
  const [rows, setRows] = createSignal<(TreeRow | undefined)[]>([]);
  const [total, setTotal] = createSignal(0);
  const [matches, setMatches] = createSignal(0);
  const keyIndex = new Map<string, number>(); // clé → position, pour les lignes chargées
  let viewport = { start: 0, end: PAGE }; // lignes à l'écran (virtualiseur)
  let reqId = 0;
  let inFlight = new Set<number>(); // pages demandées pour la requête courante
  let lastSig = "";
  const [scrollReset, setScrollReset] = createSignal(0); // le virtualiseur remonte en haut quand il change

  // Curseur et sélection (les samples sélectionnés sont gardés à part : leurs lignes peuvent sortir des pages).
  const [cursor, setCursor] = createSignal<string | null>(null); // clé de ligne
  const [selection, setSelection] = createSignal<string[]>([]); // clés de lignes sample
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const selData = new Map<string, Sample>();

  function place(arr: (TreeRow | undefined)[], offset: number, page: TreeRow[]) {
    page.forEach((r, i) => {
      arr[offset + i] = r;
      keyIndex.set(r.key, offset + i);
    });
  }

  /** Recharge : la page à l'écran et celle de `focusKey` (le curseur par défaut), en un seul échange. Rend la
   *  position de `focusKey` dans la liste complète. */
  async function refresh(focusKey: string | null = cursor()): Promise<number | null> {
    const id = ++reqId;
    inFlight = new Set();
    const t0 = performance.now();
    const base = o.request();
    const sig = o.signature(base);
    if (sig !== lastSig) {
      lastSig = sig;
      viewport = { start: 0, end: PAGE };
      setScrollReset((n) => n + 1);
    }
    const first = Math.floor(viewport.start / PAGE);
    // Une page suffit à remplir l'écran (~30 lignes + marge) ; les suivantes arrivent au défilement.
    const page = await o.fetch({ ...base, offset: first * PAGE, limit: PAGE, focus: focusKey });
    if (id !== reqId) return null; // requête périmée
    const t1 = performance.now();
    const arr: (TreeRow | undefined)[] = new Array(page.totalRows);
    const fi = page.focusIndex ?? null;
    let extra: TreePage | null = null;
    if (fi !== null && (fi < first * PAGE || fi >= first * PAGE + page.rows.length)) {
      extra = await o.fetch({ ...base, offset: Math.floor(fi / PAGE) * PAGE, limit: PAGE });
      if (id !== reqId) return null;
    }
    keyIndex.clear();
    place(arr, first * PAGE, page.rows);
    if (extra && fi !== null) place(arr, Math.floor(fi / PAGE) * PAGE, extra.rows);
    batch(() => {
      setRows(arr);
      setTotal(page.totalRows);
      setMatches(page.matches);
      for (const k of selData.keys()) {
        const r = rowByKey(k);
        if (r?.type === "sample") selData.set(k, r.sample);
      }
      o.onRefreshed?.();
    });
    o.onLoaded?.({ page, t0, t1, t2: performance.now() });
    return fi;
  }

  /** Charge les pages qui couvrent [start, end) si besoin (défilement, flèches, ⇧-sélection). */
  async function ensureRange(start: number, end: number) {
    const id = reqId;
    const base = o.request();
    const want: number[] = [];
    for (let p = Math.floor(Math.max(0, start) / PAGE); p * PAGE < Math.min(end, total()); p++) {
      if (rows()[p * PAGE] === undefined && !inFlight.has(p)) want.push(p);
    }
    await Promise.all(
      want.map(async (p) => {
        inFlight.add(p);
        const page = await o.fetch({ ...base, offset: p * PAGE, limit: PAGE });
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

  /** Position d'une ligne peut-être pas chargée (parent lointain, saut), chargée au passage. */
  async function locate(key: string): Promise<number> {
    if (indexOf(key) >= 0) return indexOf(key);
    const page = await o.fetch({ ...o.request(), offset: 0, limit: 0, focus: key });
    const fi = page.focusIndex ?? null;
    if (fi === null) return -1;
    await ensureRange(fi, fi + 1);
    return fi;
  }

  /** Nombre de lignes affichées (le scénario « Indexation » le limite pour simuler un arbre qui se remplit). */
  const shownTotal = () => {
    const lim = o.visibleLimit?.() ?? null;
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
  const sampleById = (id: SampleId) => {
    const r = rows().find((r) => r?.type === "sample" && r.sample.id === id);
    return r?.type === "sample" ? r.sample : undefined;
  };

  function setSelected(keys: string[]) {
    selData.clear();
    for (const k of keys) {
      const r = rowByKey(k);
      if (r?.type === "sample") selData.set(k, r.sample);
    }
    setSelection(keys);
  }

  /** Samples sélectionnés (gardés même hors des pages chargées). */
  const selectedData = () => selection().flatMap((k) => (selData.has(k) ? [selData.get(k)!] : []));

  /** Ajoute ou retire une ligne de la sélection (⌘-clic), en gardant les samples déjà connus. */
  function toggleSelected(key: string) {
    const cur = selection();
    const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
    const keep = new Map(selData);
    setSelected(next);
    for (const k of next) if (!selData.has(k) && keep.has(k)) selData.set(k, keep.get(k)!);
  }

  return {
    rows, total, matches, scrollReset, refresh, ensureRange, setViewRange, locate, shownTotal, rowAt, visible, indexOf,
    rowByKey, sampleById, cursor, setCursor, selection, setSelection, anchor, setAnchor, setSelected, selectedData,
    toggleSelected,
  };
}

export type ListModel = ReturnType<typeof createListModel>;
