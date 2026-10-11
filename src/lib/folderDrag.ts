// Glisser d'un dossier virtuel (déplacement dans un autre, ou à la racine) : à la souris, avec les événements du
// pointeur, pas en HTML5. Dans la fenêtre Tauri, le glisser HTML interne n'arrive pas jusqu'à la page (Tauri reçoit
// les dépôts sur la fenêtre) ; celui-ci ne quitte jamais la page, il marche pareil dans le navigateur.
import type { NodeKey } from "../api";
import { app } from "../state/app";
import { endHover, hoverAt } from "./dragHover";

/** Distance (px) en deçà de laquelle un appui reste un clic. */
const THRESHOLD = 4;

/** Appui sur une ligne de dossier virtuel : le glisser commence si le pointeur s'éloigne de plus de 4 px. */
export function beginFolderDrag(e: PointerEvent, key: NodeKey, name: string) {
  if (e.button !== 0) return;
  const row = e.currentTarget as HTMLElement;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost: HTMLElement | null = null;

  const start = () => {
    window.getSelection()?.removeAllRanges();
    document.documentElement.classList.add("cr-dragging-folder");
    app.setDraggingKey(key);
    // Pastille sous le pointeur : icône de la ligne et nom du dossier.
    const g = document.createElement("div");
    g.className = "cr-drag-ghost";
    const icon = row.querySelector(".cr-node__icon")?.cloneNode(true);
    if (icon) g.append(icon);
    const label = document.createElement("span");
    label.textContent = name;
    g.append(label);
    (row.closest(".cr-root") ?? document.body).append(g);
    return g;
  };

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      ghost = start();
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
    hoverAt(ev.clientX, ev.clientY);
  };

  const finish = (drop: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    if (!ghost) return;
    ghost.remove();
    document.documentElement.classList.remove("cr-dragging-folder");
    const target = app.dropTarget();
    endHover();
    // Le clic qui suit le lâcher n'est pas un clic.
    const swallow = (ev: MouseEvent) => ev.stopPropagation();
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }));
    if (drop && target) void app.dropOn(target);
    else app.setDraggingKey(null);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
}
