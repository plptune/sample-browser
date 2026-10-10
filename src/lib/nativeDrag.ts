// Glisser natif des samples (fenêtre Tauri, vraie bibliothèque) : les fichiers partent vers le DAW ou le Finder
// comme depuis le Finder. Dans la fenêtre elle-même, le dépôt (collection, dossier virtuel, onglet) est retrouvé
// à partir des événements de dépôt de Tauri. Dans le navigateur, le glisser HTML reste utilisé.
import { app } from "../state/app";

let springTimer = 0;
let springTab: string | null = null;
/** Dernier glisser natif : gardé un instant après sa fin, l'événement de dépôt de Tauri arrivant après coup. */
let last: { key: string; files: string[]; target: string | null; endedAt: number | null; dropped: boolean } | null = null;

/** Vrai si ces chemins sont ceux du glisser natif en cours (ou qui vient de finir). */
export function isOwnDrag(paths?: string[]): boolean {
  if (!last) return false;
  if (last.endedAt !== null && performance.now() - last.endedAt > 1500) return false;
  return !paths || (paths.length === last.files.length && paths.every((p) => last!.files.includes(p)));
}

/** Petite pastille « n » dessinée à la volée (PNG base64, format attendu par le plugin). */
function dragIcon(count: number): string {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const [w, h] = [count > 9 ? 34 : 26, 22];
  const c = document.createElement("canvas");
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#2b2b2b";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 6);
  ctx.fill();
  ctx.fillStyle = "#e6e6e6";
  ctx.font = "600 12px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), w / 2, h / 2 + 0.5);
  return c.toDataURL("image/png");
}

/** Début d'un glisser de sample : remplace le glisser HTML par un glisser natif de fichiers. */
export async function startNativeDrag(rowKey: string) {
  if (!app.selection().includes(rowKey)) app.select(rowKey);
  const files = app.selectedSamples().filter((s) => !s.missing).map((s) => s.path);
  if (!files.length) return;
  if (app.stopOnDrag() && app.playingId() !== null) app.stop();
  app.setDraggingKey(rowKey);
  last = { key: rowKey, files, target: null, endedAt: null, dropped: false };
  const { startDrag } = await import("@crabnebula/tauri-plugin-drag");
  await startDrag({ item: files, icon: dragIcon(files.length) }, (e) => {
    // Fin du glisser (dans le DAW, le Finder ou ici) : le dépôt dans la fenêtre, s'il y en a un, suit.
    clearTimeout(springTimer);
    const drag = last;
    if (drag) drag.endedAt = performance.now();
    app.setDraggingKey(null);
    app.setDropTarget(null);
    // Déposé ailleurs que dans Crate (le DAW) : si l'on était venu du DAW par son raccourci, on lui rend la main.
    // L'événement de dépôt de Tauri arrive après coup : on lui laisse un instant pour marquer un dépôt ici.
    if (e.result === "Dropped") setTimeout(() => drag && !drag.dropped && void app.returnToDaw(), 300);
  });
}

/** Le glisser natif survole la fenêtre (coordonnées logiques) : cible de dépôt et onglet à ouvrir. */
export function nativeDragOver(x: number, y: number) {
  const el = document.elementFromPoint(x, y);
  const tab = el?.closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null;
  if (tab !== springTab) {
    clearTimeout(springTimer);
    springTab = tab;
    if (tab && tab !== app.tab()) springTimer = window.setTimeout(() => app.switchTab(tab as "library" | "virtual"), 500);
  }
  const row = el?.closest<HTMLElement>("[data-key]")?.dataset.key;
  const target = row ?? (el?.closest(".cr-tree") ? "root" : null);
  const ok = target && app.canDrop(target) ? target : null;
  if (last) last.target = ok;
  app.setDropTarget(ok);
}

/** Lâché dans la fenêtre : même effet qu'un dépôt HTML. */
export function nativeDrop() {
  clearTimeout(springTimer);
  springTab = null;
  // Tauri peut livrer le même dépôt deux fois : le second est ignoré (et ne passe pas pour un dossier du Finder).
  const d = last;
  if (!d || d.dropped) return;
  d.dropped = true;
  if (!d.target) return app.setDropTarget(null);
  // dropOn s'appuie sur la ligne glissée : on la remet le temps du dépôt.
  app.setDraggingKey(d.key);
  void app.dropOn(d.target);
}

export function nativeDragLeave() {
  clearTimeout(springTimer);
  springTab = null;
  app.setDropTarget(null);
}
