// Survol pendant un glisser, commun au glisser natif des samples et au glisser des dossiers virtuels : cible de dépôt
// sous le pointeur, onglet ouvert après 500 ms, défilement de l'arbre près de ses bords.
import type { NodeKey } from "../api";
import { app } from "../state/app";

/** Bande (px) en haut et en bas de l'arbre où le glisser le fait défiler ; vitesse maximale (px par image). */
const EDGE = 28;
const SPEED = 12;

let springTimer = 0;
let springTab: string | null = null;
let pos = { x: 0, y: 0 };
let raf = 0;
let onTarget: ((target: NodeKey | null) => void) | null = null;

/** Cible valide sous le point : une ligne, ou le fond de l'onglet Virtuels (racine). */
function targetAt(el: Element | null): NodeKey | null {
  const row = el?.closest<HTMLElement>("[data-key]")?.dataset.key;
  const target = row ?? (el?.closest(".cr-tree") && app.tab() === "virtual" ? "root" : null);
  return target && app.canDrop(target) ? target : null;
}

function retarget(el: Element | null) {
  const ok = targetAt(el);
  app.setDropTarget(ok);
  onTarget?.(ok);
}

/** Une image de défilement : la cible est relue d'abord (les lignes ont bougé sous un pointeur immobile). */
function scrollStep() {
  raf = 0;
  const el = document.elementFromPoint(pos.x, pos.y);
  retarget(el);
  const tree = el?.closest<HTMLElement>(".cr-tree");
  if (!tree) return;
  const r = tree.getBoundingClientRect();
  const depth = pos.y < r.top + EDGE ? pos.y - (r.top + EDGE) : pos.y > r.bottom - EDGE ? pos.y - (r.bottom - EDGE) : 0;
  if (!depth) return;
  const before = tree.scrollTop;
  tree.scrollTop += Math.sign(depth) * Math.ceil((Math.min(Math.abs(depth), EDGE) / EDGE) * SPEED);
  if (tree.scrollTop !== before) raf = requestAnimationFrame(scrollStep);
}

/** Le glisser survole (x, y) (coordonnées de la page) : met à jour la cible ; `cb` la reçoit à chaque changement. */
export function hoverAt(x: number, y: number, cb?: (target: NodeKey | null) => void): NodeKey | null {
  pos = { x, y };
  onTarget = cb ?? null;
  const el = document.elementFromPoint(x, y);
  const tab = el?.closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null;
  if (tab !== springTab) {
    clearTimeout(springTimer);
    springTab = tab;
    if (tab && tab !== app.tab()) springTimer = window.setTimeout(() => app.switchTab(tab as "library" | "virtual"), 500);
  }
  retarget(el);
  if (!raf) raf = requestAnimationFrame(scrollStep);
  return app.dropTarget();
}

/** Fin du survol (dépôt, sortie, annulation) : plus de cible, plus d'onglet en attente, plus de défilement. */
export function endHover() {
  clearTimeout(springTimer);
  springTab = null;
  cancelAnimationFrame(raf);
  raf = 0;
  onTarget = null;
  app.setDropTarget(null);
}
