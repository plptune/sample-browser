// Survol pendant un glisser, commun au glisser natif des samples, au glisser des dossiers virtuels, aux fichiers venus
// d'une autre app et au glisser HTML : cible de dépôt sous le pointeur, onglet (ou panneau masqué) ouvert après 500 ms,
// défilement de l'arbre près de ses bords.
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

/** Cible valide sous le point, dans un arbre seulement : la ligne survolée ou le dossier qui la contient, sinon le
 *  fond d'un arbre des Virtuels (racine). */
export function targetAt(el: Element | null): NodeKey | null {
  const zone = el?.closest<HTMLElement>(".cr-tree[data-drop-zone]");
  if (!zone) return null;
  const row = el!.closest<HTMLElement>("[data-key]")?.dataset.key;
  if (row) return app.dropTargetFor(row);
  return zone.dataset.root === "virtual" && app.canDrop("root") ? "root" : null;
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
    // Onglet (colonne) ou bouton d'un panneau masqué (Expanded) : la racine est mise à l'écran.
    if (tab === "library" || tab === "virtual") {
      if (!app.rootShown(tab)) springTimer = window.setTimeout(() => app.revealRoot(tab), 500);
    }
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
