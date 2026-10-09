// Waveform dessinée dans un <canvas> à partir de pics précalculés (256 valeurs 0..1).
// Les couleurs sont lues dans les tokens CSS hérités, donc suivent le thème.
import { createEffect, onCleanup, onMount } from "solid-js";

export function Waveform(props: {
  peaks: number[];
  progress?: number; // 0..1, absent = pas de lecture
  variant?: "full" | "mini";
  themeKey?: string; // force un redessin au changement de thème
  class?: string;
}) {
  let canvas!: HTMLCanvasElement;
  const [w, h] = [{ v: 0 }, { v: 0 }];

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const cw = w.v;
    const ch = h.v;
    if (!cw || !ch) return;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const css = getComputedStyle(canvas);
    const mini = props.variant === "mini";
    const base = css.getPropertyValue(mini ? "--cr-wave-mini" : "--cr-wave").trim();
    const played = css.getPropertyValue("--cr-wave-played").trim();
    const p = props.progress;
    const peaks = props.peaks;
    const step = mini ? 2 : 3; // pas en px : barre + 1 px d'espace
    const bars = Math.floor(cw / step);
    const mid = ch / 2;
    for (let i = 0; i < bars; i++) {
      const v = peaks[Math.floor((i / bars) * peaks.length)] ?? 0;
      if (v < 0.06) continue; // pas de ligne de base pointillée sur les silences
      const bh = Math.max(1, v * (ch - 2));
      ctx.fillStyle = p !== undefined && i / bars < p ? played : base;
      ctx.fillRect(i * step, mid - bh / 2, step - 1, bh);
    }
    if (p !== undefined && !mini) {
      ctx.fillStyle = played;
      ctx.fillRect(Math.round(p * cw), 0, 1, ch);
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(([e]) => {
      w.v = Math.round(e.contentRect.width);
      h.v = Math.round(e.contentRect.height);
      draw();
    });
    ro.observe(canvas);
    onCleanup(() => ro.disconnect());
  });

  createEffect(() => {
    void props.peaks;
    void props.progress;
    draw();
  });

  // Le changement de thème est appliqué au DOM après ce signal : on redessine à la frame suivante.
  createEffect(() => {
    void props.themeKey;
    requestAnimationFrame(draw);
  });

  return <canvas ref={canvas} class={props.class} />;
}
