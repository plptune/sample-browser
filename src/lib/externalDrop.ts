// Fichiers glissés depuis une autre app (Finder, Sononym…) au-dessus de la fenêtre. Sur un dossier virtuel, une
// collection manuelle ou les favoris (le même survol que les autres glissers : bloc en surbrillance, onglet ouvert après
// 500 ms, défilement), les samples de la bibliothèque qu'ils désignent y sont ajoutés ; ailleurs, un dossier déposé
// devient une source, comme avant.
import { app } from "../state/app";
import { endHover, hoverAt } from "./dragHover";

let paths: string[] = [];
/** Tauri peut livrer le même dépôt deux fois : le second est ignoré. */
let last = { sig: "", at: 0 };

export function externalEnter(p: string[]) {
  paths = p;
  app.setExternalDrag(true);
  app.setFileOver(p.length > 0);
}

/** Survol en (x, y), coordonnées de la page. */
export function externalOver(x: number, y: number) {
  hoverAt(x, y);
}

export function externalDrop(p: string[], x?: number, y?: number) {
  if (x !== undefined && y !== undefined) hoverAt(x, y);
  const target = app.dropTarget();
  const files = p.length ? p : paths;
  externalLeave();
  const sig = files.join("\n");
  if (!files.length || (sig === last.sig && performance.now() - last.at < 500)) return;
  last = { sig, at: performance.now() };
  if (target) return void app.dropFiles(target, files);
  if (!app.demo()) for (const f of files) void app.addFolder(f);
}

export function externalLeave() {
  endHover();
  app.setExternalDrag(false);
  app.setFileOver(false);
  paths = [];
}

// Tests du prototype (sans Tauri, donc sans événements de dépôt de fichiers) : le même chemin, appelé directement.
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).__crateDrop = {
    enter: externalEnter,
    over: externalOver,
    drop: externalDrop,
    leave: externalLeave,
  };
}
