// Waveform dessinée dans un <canvas>. Les couleurs sont lues dans les tokens CSS hérités, donc suivent le thème.
// - `mini` (lignes de l'arbre) : barres à partir des 256 pics.
// - `full` (tiroir, inspecteur) : forme pleine continue à partir d'une forme d'onde détaillée (min / max / RMS)
//   demandée à la largeur affichée (`loadDetail`), sinon des 256 pics. La partie lue et la tête de lecture sont
//   dessinées sur un second canvas, à chaque image pendant la lecture (position extrapolée entre deux événements).
import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { Waveform as WaveformData } from "../api";

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
  const full = () => props.variant !== "mini";

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
    const peaks = props.peaks;
    const step = mini ? 2 : 3; // pas en px : barre + 1 px d'espace
    const bars = Math.floor(w / step);
    const mid = h / 2;
    for (let i = 0; i < bars; i++) {
      const v = peaks[Math.floor((i / bars) * peaks.length)] ?? 0;
      if (v < 0.06) continue; // pas de ligne de base pointillée sur les silences
      const bh = Math.max(1, v * (h - 2));
      ctx.fillStyle = progressColor && p !== undefined && i / bars < p ? progressColor : color;
      ctx.fillRect(i * step, mid - bh / 2, step - 1, bh);
    }
  }

  function draw() {
    if (!size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = fit(canvas, dpr);
    const c = colors();
    if (!full()) {
      drawBars(ctx, c.base, c.played, props.progress);
      return;
    }
    const d = detail();
    const pctx = fit(played, dpr);
    if (d) {
      drawShape(ctx, c.base, d);
      drawShape(pctx, c.played, d);
    } else {
      drawBars(ctx, c.base);
      drawBars(pctx, c.played);
    }
    drawHead();
  }

  // --- tête de lecture : position annoncée + temps écoulé depuis, redessinée à chaque image pendant la lecture
  let anchor = { p: 0, t: 0 };
  let raf = 0;
  function estimate(): number | undefined {
    const p = props.progress;
    if (p === undefined) return undefined;
    const dur = props.durationMs ?? 0;
    if (!dur) return p;
    const x = anchor.p + (performance.now() - anchor.t) / dur;
    return props.looping ? x % 1 : Math.min(1, x);
  }
  function drawHead() {
    if (!overlay || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = fit(overlay, dpr);
    const p = estimate();
    if (p === undefined) return;
    const px = Math.max(0, Math.min(size.w, p * size.w));
    if (px > 0) ctx.drawImage(played, 0, 0, px * dpr, size.h * dpr, 0, 0, px, size.h);
    ctx.fillStyle = colors().played;
    ctx.fillRect(Math.round(px), 0, 1, size.h);
  }
  function loop() {
    drawHead();
    raf = props.progress !== undefined ? requestAnimationFrame(loop) : 0;
  }
  createEffect(
    on(
      () => props.progress,
      (p) => {
        if (!full()) return draw();
        if (p !== undefined) anchor = { p, t: performance.now() };
        if (p !== undefined && !raf) raf = requestAnimationFrame(loop);
        if (p === undefined) drawHead();
      },
    ),
  );
  onCleanup(() => cancelAnimationFrame(raf));

  // --- forme détaillée : redemandée au changement de sample ou de largeur (après 150 ms sans redimensionnement)
  let timer = 0;
  let wanted = "";
  function requestDetail() {
    const load = props.loadDetail;
    if (!load || !size.w) return;
    const buckets = Math.round(size.w * (window.devicePixelRatio || 1));
    const key = `${props.detailKey}|${buckets}`;
    if (key === wanted) return;
    wanted = key;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      void load(buckets).then((d) => {
        if (wanted === key) setDetail(d.max.length ? d : null);
      });
    }, 150);
  }
  onCleanup(() => clearTimeout(timer));
  createEffect(
    on(
      () => props.detailKey,
      () => {
        setDetail(null);
        wanted = "";
        requestDetail();
      },
    ),
  );

  onMount(() => {
    const ro = new ResizeObserver(([e]) => {
      size.w = Math.round(e.contentRect.width);
      size.h = Math.round(e.contentRect.height);
      draw();
      requestDetail();
    });
    ro.observe(canvas);
    onCleanup(() => ro.disconnect());
  });

  createEffect(() => {
    void props.peaks;
    void detail();
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
