// Waveform dessinée dans un <canvas>. Les couleurs sont lues dans les tokens CSS hérités, donc suivent le thème.
// - `mini` (lignes de l'arbre) : barres à partir des 256 pics.
// - `full` (tiroir, inspecteur) : forme pleine continue à partir d'une forme d'onde détaillée (min / max / RMS)
//   demandée à la largeur affichée (`loadDetail`) ; rien n'est dessiné avant qu'elle arrive. La partie lue et la tête sont
//   dessinées sur un second canvas, à chaque image pendant la lecture (position extrapolée entre deux événements).
// - Fichier MIDI (`loadNotes`) : les notes en piano roll (hauteur × temps) à la place de l'onde, dans les deux variantes.
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import type { MidiNotes, Waveform as WaveformData } from "../api";

export function Waveform(props: {
  peaks: number[];
  progress?: number; // 0..1, absent = pas de lecture
  variant?: "full" | "mini";
  themeKey?: string; // force un redessin au changement de thème
  class?: string;
  /** Clic : position 0..1 dans le sample (tiroir : lire à partir de ce point). */
  onSeek?: (fraction: number) => void;
  /** Forme d'onde détaillée en `buckets` colonnes ; redemandée quand `detailKey` ou la largeur change. */
  loadDetail?: (buckets: number) => Promise<WaveformData>;
  detailKey?: string | number;
  /** Fichier MIDI : ses notes, dessinées à la place de l'onde ; redemandées quand `detailKey` ou la fonction change. */
  loadNotes?: () => Promise<MidiNotes>;
  /** Durée du sample : la tête avance entre deux positions annoncées (60 images / s). */
  durationMs?: number;
  looping?: boolean;
}) {
  let canvas!: HTMLCanvasElement;
  let overlay: HTMLCanvasElement | undefined;
  /** Forme dessinée dans la couleur « lue », recadrée à la progression sur l'overlay. */
  const played = document.createElement("canvas");
  const size = { w: 0, h: 0 };
  const [detail, setDetail] = createSignal<WaveformData | null>(null);
  const [notes, setNotes] = createSignal<MidiNotes | null>(null);
  // Props lues aussi hors de tout suivi (requestAnimationFrame, ResizeObserver) : passées par des memos du composant.
  // Une prop écrite en expression (`playing ? progress : undefined`) devient un memo créé à chaque lecture ; lu hors
  // de tout propriétaire, ce memo n'était jamais libéré et restait abonné à la ligne d'arbre, réévalué (et levait une
  // erreur) une fois la ligne disparue. Un memo du composant, lui, part avec le composant et garde sa dernière valeur.
  const progress = createMemo(() => props.progress);
  const peaks = createMemo(() => props.peaks);
  const loadNotes = createMemo(() => props.loadNotes);
  const loadDetail = createMemo(() => props.loadDetail);
  const detailKey = createMemo(() => props.detailKey);
  const durationMs = createMemo(() => props.durationMs);
  const looping = createMemo(() => props.looping);
  const full = () => props.variant !== "mini";
  /** Rien à dessiner tant que la source attendue (notes, forme détaillée) n'est pas arrivée. */
  const ready = () => (loadNotes() ? !!notes() : !loadDetail() || !!detail());

  function colors() {
    const css = getComputedStyle(canvas);
    const mini = props.variant === "mini";
    return {
      base: css.getPropertyValue(mini ? "--cr-wave-mini" : "--cr-wave").trim(),
      played: css.getPropertyValue("--cr-wave-played").trim(),
    };
  }

  function fit(c: HTMLCanvasElement, dpr: number) {
    if (c.width !== size.w * dpr || c.height !== size.h * dpr) {
      c.width = size.w * dpr;
      c.height = size.h * dpr;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    return ctx;
  }

  /** Forme pleine : enveloppe min / max atténuée, cœur RMS plein. */
  function drawShape(ctx: CanvasRenderingContext2D, color: string, d: WaveformData) {
    const { w, h } = size;
    const mid = h / 2;
    const amp = mid - 1;
    const n = d.max.length;
    if (!n) return;
    const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const band = (top: (i: number) => number, bottom: (i: number) => number) => {
      ctx.beginPath();
      ctx.moveTo(0, mid - top(0) * amp);
      for (let i = 1; i < n; i++) ctx.lineTo(x(i), mid - top(i) * amp);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(x(i), mid - bottom(i) * amp);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    // Au moins un demi-pixel d'épaisseur : un silence reste une ligne fine, pas un vide.
    band(
      (i) => Math.max(d.max[i], 0.5 / amp),
      (i) => Math.min(d.min[i], -0.5 / amp),
    );
    ctx.globalAlpha = 1;
    band(
      (i) => Math.min(d.rms[i], d.max[i]),
      (i) => Math.max(-d.rms[i], d.min[i]),
    );
  }

  /** Barres à partir des 256 pics (arbre, ou en attendant la forme détaillée). */
  function drawBars(ctx: CanvasRenderingContext2D, color: string, progressColor?: string, p?: number) {
    const { w, h } = size;
    const mini = props.variant === "mini";
    const values = peaks();
    const step = mini ? 2 : 3; // pas en px : barre + 1 px d'espace
    const bars = Math.floor(w / step);
    const mid = h / 2;
    for (let i = 0; i < bars; i++) {
      const v = values[Math.floor((i / bars) * values.length)] ?? 0;
      if (v < 0.06) continue; // pas de ligne de base pointillée sur les silences
      const bh = Math.max(1, v * (h - 2));
      ctx.fillStyle = progressColor && p !== undefined && i / bars < p ? progressColor : color;
      ctx.fillRect(i * step, mid - bh / 2, step - 1, bh);
    }
  }

  /** Piano roll : une barre par note (hauteur de haut en bas, temps de gauche à droite), opacité selon la vélocité.
   *  Au moins une octave de haut : quelques notes proches ne deviennent pas des pavés. `p` : notes déjà jouées. */
  function drawNotes(ctx: CanvasRenderingContext2D, color: string, d: MidiNotes, progressColor?: string, p?: number) {
    const { w, h } = size;
    const n = d.notes;
    if (!n.length) return;
    const len = n.reduce((m, x) => Math.max(m, x.end), d.seconds) || 1;
    let lo = 127;
    let hi = 0;
    for (const x of n) {
      lo = Math.min(lo, x.key);
      hi = Math.max(hi, x.key);
    }
    const span = Math.max(12, hi - lo + 1);
    const top = hi + Math.floor((span - (hi - lo + 1)) / 2);
    const row = (h - 2) / span;
    const nh = Math.max(1, row > 3 ? row - 1 : row);
    if (full()) {
      // Repères des do : une ligne fine par octave.
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.12;
      for (let k = top; k > top - span; k--) if (k % 12 === 0) ctx.fillRect(0, Math.round(1 + (top - k + 1) * row), w, 1);
    }
    for (const x of n) {
      const x0 = (x.start / len) * w;
      ctx.globalAlpha = 0.45 + (0.55 * x.velocity) / 127;
      ctx.fillStyle = progressColor && p !== undefined && x.start / len < p ? progressColor : color;
      ctx.fillRect(x0, 1 + (top - x.key) * row, Math.max(full() ? 2 : 1, ((x.end - x.start) / len) * w - 1), nh);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = fit(canvas, dpr);
    const c = colors();
    if (loadNotes()) {
      const d = notes();
      canvas.dataset.shape = d ? "notes" : "none";
      if (d) canvas.dataset.notes = String(d.notes.length);
      else delete canvas.dataset.notes;
      if (!full()) return d && drawNotes(ctx, c.base, d, c.played, progress());
      const pctx = fit(played, dpr);
      if (d) {
        drawNotes(ctx, c.base, d);
        drawNotes(pctx, c.played, d);
      }
      return drawHead();
    }
    delete canvas.dataset.notes;
    if (!full()) {
      drawBars(ctx, c.base, c.played, progress());
      return;
    }
    // Tant que la forme détaillée du sample affiché n'est pas là : rien (ni barres, ni forme approchée).
    const pctx = fit(played, dpr);
    if (!loadDetail()) {
      // Sans source détaillée (stories) : barres des pics.
      canvas.dataset.shape = "bars";
      drawBars(ctx, c.base);
      drawBars(pctx, c.played);
      return drawHead();
    }
    const d = detail();
    canvas.dataset.shape = d ? "detail" : "none";
    if (d) {
      drawShape(ctx, c.base, d);
      drawShape(pctx, c.played, d);
    }
    drawHead();
  }

  // --- tête de lecture : position annoncée + temps écoulé depuis, redessinée à chaque image pendant la lecture
  let anchor = { p: 0, t: 0 };
  let raf = 0;
  function estimate(): number | undefined {
    const p = progress();
    if (p === undefined) return undefined;
    const dur = durationMs() ?? 0;
    if (!dur) return p;
    const x = anchor.p + (performance.now() - anchor.t) / dur;
    return looping() ? x % 1 : Math.min(1, x);
  }
  function drawHead() {
    if (!overlay || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = fit(overlay, dpr);
    const p = estimate();
    if (p === undefined || !ready()) return;
    const px = Math.max(0, Math.min(size.w, p * size.w));
    if (px > 0) ctx.drawImage(played, 0, 0, px * dpr, size.h * dpr, 0, 0, px, size.h);
    ctx.fillStyle = colors().played;
    ctx.fillRect(Math.round(px), 0, 1, size.h);
  }
  function loop() {
    drawHead();
    raf = progress() !== undefined ? requestAnimationFrame(loop) : 0;
  }
  createEffect(
    on(
      progress,
      (p) => {
        if (!full()) return draw();
        if (p !== undefined) anchor = { p, t: performance.now() };
        if (p !== undefined && !raf) raf = requestAnimationFrame(loop);
        if (p === undefined) drawHead();
      },
    ),
  );
  onCleanup(() => cancelAnimationFrame(raf));

  // --- forme détaillée : demandée tout de suite au changement de sample ; au redimensionnement, après 150 ms et
  // seulement si la largeur a changé de plus de 10 %. Colonnes arrondies au multiple de 128 supérieur : la mise en
  // page qui se stabilise ne relance pas de demande.
  let timer = 0;
  let wanted = { key: undefined as string | number | undefined, buckets: 0 };
  const bucketsFor = (w: number) => Math.max(128, Math.ceil((w * (window.devicePixelRatio || 1)) / 128) * 128);
  function load(buckets: number) {
    const fetch = loadDetail();
    const key = detailKey();
    if (!fetch) return;
    wanted = { key, buckets };
    void fetch(buckets).then((d) => {
      // Réponse périmée (autre sample, autre taille) : ignorée.
      if (wanted.key === key && wanted.buckets === buckets) setDetail(d.max.length ? d : null);
    });
  }
  function onResize() {
    if (!loadDetail() || !size.w) return;
    const b = bucketsFor(size.w);
    if (wanted.key !== detailKey()) return load(b); // premier dessin de ce sample
    if (Math.abs(b - wanted.buckets) / wanted.buckets <= 0.1) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => load(bucketsFor(size.w)), 150);
  }
  onCleanup(() => clearTimeout(timer));
  createEffect(
    on(
      () => detailKey(),
      () => {
        clearTimeout(timer);
        setDetail(null);
        wanted = { key: undefined, buckets: 0 };
        if (size.w) load(bucketsFor(size.w));
      },
    ),
  );

  onMount(() => {
    const ro = new ResizeObserver(([e]) => {
      size.w = Math.round(e.contentRect.width);
      size.h = Math.round(e.contentRect.height);
      draw();
      onResize();
    });
    ro.observe(canvas);
    onCleanup(() => ro.disconnect());
  });

  // --- notes d'un fichier MIDI : redemandées au changement de sample ; réponse périmée ignorée.
  let notesAsked = 0;
  createEffect(
    on([() => loadNotes(), () => detailKey()], ([fetch]) => {
      const asked = ++notesAsked;
      setNotes(null);
      if (fetch) void fetch().then((d) => asked === notesAsked && setNotes(d));
    }),
  );

  createEffect(() => {
    void peaks();
    void detail();
    void notes();
    draw();
  });

  // Le changement de thème est appliqué au DOM après ce signal : on redessine à la frame suivante.
  createEffect(() => {
    void props.themeKey;
    requestAnimationFrame(draw);
  });

  const seek = (e: MouseEvent) => {
    if (!props.onSeek || e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    props.onSeek((e.clientX - r.left) / Math.max(1, r.width));
  };

  return (
    <>
      <canvas ref={canvas} class={props.class} data-seekable={props.onSeek ? "" : undefined} onMouseDown={seek} />
      {full() && <canvas ref={overlay} class="cr-wave__overlay" aria-hidden="true" onMouseDown={seek} data-seekable={props.onSeek ? "" : undefined} />}
    </>
  );
}
