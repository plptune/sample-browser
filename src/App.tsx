import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { PanelShell } from "./components/PanelShell";
import { DemoBar } from "./demo/DemoBar";
import { SCENARIOS, acOpen } from "./demo/scenarios";
import { app } from "./state/app";

const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");

import { COLOR_VARS, colorVars } from "./lib/color";
import { inTauri } from "./lib/env";
import { isOwnDrag, nativeDragLeave, nativeDragOver, nativeDrop } from "./lib/nativeDrag";

export function App() {
  const [scenario, setScenario] = createSignal(3);
  let search: HTMLInputElement | undefined;

  // Les scénarios s'enchaînent : deux touches rapides ne mélangent pas leurs états.
  let queue: Promise<void> = Promise.resolve();
  const runScenario = (id: number) => {
    setScenario(id);
    queue = queue.then(async () => {
      await SCENARIOS.find((s) => s.id === id)?.run();
    });
  };

  function onKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    // ⌘⇧F : grande fenêtre (arbre large + inspecteur) ou retour en colonne.
    if (mod && e.shiftKey && key === "f") {
      e.preventDefault();
      void app.toggleLayout();
      return;
    }
    if (mod && key === "f") {
      e.preventDefault();
      app.setView("browser");
      queueMicrotask(() => search?.focus());
      return;
    }
    if (mod && key === "s") {
      e.preventDefault();
      app.openSaveSearch();
      return;
    }
    // ⌥⌘D : overlay de mesures (e.code : ⌥ change le caractère tapé sur Mac).
    if (mod && e.altKey && e.code === "KeyD") {
      e.preventDefault();
      app.setDebug(!app.debug());
      return;
    }
    if (mod && key === "d" && !isField(e.target)) {
      e.preventDefault();
      app.toggleFavorite();
      return;
    }
    if (mod && (e.key === "1" || e.key === "2")) {
      e.preventDefault();
      app.switchTab(e.key === "1" ? "library" : "virtual");
      return;
    }
    // Historique : ⌘[ / ⌘] partout, ⌥← / ⌥→ hors des champs (où ils déplacent le curseur d'un mot).
    if (mod && (e.key === "[" || e.key === "]")) {
      e.preventDefault();
      e.key === "[" ? app.back() : app.forward();
      return;
    }
    // ⌘⌥← / ⌘⌥→ : fenêtre calée contre le bord gauche / droit de l'écran (e.code : ⌥ change la touche lue).
    if (mod && e.altKey && !e.shiftKey && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
      e.preventDefault();
      void app.snapWindow(e.code === "ArrowLeft" ? "left" : "right");
      return;
    }
    // ⌘← / ⌘→ : referme tous les dossiers (hors des champs, où ils vont en début ou fin de ligne).
    if (mod && !e.altKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !isField(e.target) && app.view() === "browser") {
      e.preventDefault();
      document.querySelector<HTMLElement>(".cr-tree")?.focus();
      void app.collapseAll();
      return;
    }
    if (e.altKey && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !isField(e.target)) {
      e.preventDefault();
      e.key === "ArrowLeft" ? app.back() : app.forward();
      return;
    }
    // ⌥⌘R : e.code, car ⌥ change le caractère tapé sur Mac (« ® »).
    if (mod && e.altKey && e.code === "KeyR" && !isField(e.target)) {
      e.preventDefault();
      app.finderForSelection();
      return;
    }
    // Menu contextuel au clavier : ⇧F10 ou la touche « menu », sur la ligne du curseur.
    if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      openMenuAtCursor();
      return;
    }
    if (mod && e.shiftKey && key === "n") {
      e.preventDefault();
      void app.newCollection();
      return;
    }
    if (mod && e.key === "Backspace" && !isField(e.target)) {
      e.preventDefault();
      void app.removeOrHide();
      return;
    }
    if (mod && key === "l" && !isField(e.target)) {
      e.preventDefault();
      app.setLooping(!app.looping());
      return;
    }
    if (mod && e.shiftKey && e.key === " " && !isField(e.target)) {
      e.preventDefault();
      void app.playRandom();
      return;
    }
    if (mod && key === "o") {
      e.preventDefault();
      if (!app.demo()) app.addFolder();
      return;
    }
    if (mod && key === "n") {
      e.preventDefault();
      app.newVirtualFolder();
      return;
    }
    if (mod && e.key === ",") {
      e.preventDefault();
      app.setView(app.view() === "settings" ? "browser" : "settings");
      return;
    }
    if (isField(e.target)) return;
    if (mod) return;

    if (e.key === "Escape") {
      if (app.menu() || app.tagging() || app.saving() !== null) app.closeOverlays();
      else if (app.view() === "settings") app.setView("browser");
      else if (app.view() === "commit") app.commit()?.status !== "running" && app.closeCommit();
      else app.stop();
      return;
    }
    // Touches de scénario (démo seulement) : actives dans toutes les vues.
    const sc = app.demo() ? SCENARIOS.find((x) => x.key === e.key) : undefined;
    if (sc) {
      e.preventDefault(); // sinon le caractère atterrit dans le champ que le scénario vient de focaliser
      runScenario(sc.id);
      return;
    }
    if (app.view() !== "browser") return;

    const tree = () => document.querySelector<HTMLElement>(".cr-tree");
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        tree()?.focus();
        app.move(e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
        return;
      case "ArrowRight":
        e.preventDefault();
        tree()?.focus();
        if (e.shiftKey) return app.nudge(0.1);
        app.right();
        return;
      case "ArrowLeft":
        e.preventDefault();
        tree()?.focus();
        if (e.shiftKey) return app.nudge(-0.1);
        app.left();
        return;
      case " ":
        e.preventDefault();
        app.togglePlay();
        return;
      case "Enter":
        e.preventDefault();
        app.activate();
        return;
      case "t":
      case "T":
        e.preventDefault();
        app.openTagging();
        return;
      case "/":
        e.preventDefault();
        search?.focus();
        return;
    }
  }

  function openMenuAtCursor() {
    const key = app.cursor();
    const panel = document.querySelector<HTMLElement>(".cr-panel")?.getBoundingClientRect();
    const row = key ? document.querySelector<HTMLElement>(`.cr-tree__row[data-key="${CSS.escape(key)}"]`) : null;
    if (!panel) return;
    if (!row || !key) return app.openMenu(24, 120, "root");
    const r = row.getBoundingClientRect();
    app.openMenu(r.left - panel.left + 24, r.bottom - panel.top, key);
  }

  // Dossiers glissés depuis le Finder sur la fenêtre : chacun devient une source.
  let lastDrop = { sig: "", at: 0 };
  /** ⌘F dans le DAW (raccourci pris côté Rust) : Crate est passé devant, la recherche prend le focus, texte sélectionné. */
  async function listenFocusSearch() {
    const { events } = await import("./api/bindings");
    const off = await events.focusSearchEvent.listen(() => {
      app.closeOverlays();
      app.setView("browser");
      queueMicrotask(() => {
        search?.focus();
        search?.select();
      });
    });
    onCleanup(off);
  }

  async function listenFileDrops() {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const off = await getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      // Nos propres samples, glissés nativement : cible retrouvée sous le pointeur.
      if (app.draggingKey() || isOwnDrag("paths" in p ? p.paths : undefined)) {
        if (p.type === "enter" || p.type === "over") {
          const pos = p.position.toLogical(window.devicePixelRatio || 1);
          nativeDragOver(pos.x, pos.y);
        } else if (p.type === "drop") nativeDrop();
        else nativeDragLeave();
        return;
      }
      if (p.type === "enter") app.setFileOver(p.paths.length > 0);
      else if (p.type === "leave") app.setFileOver(false);
      else if (p.type === "drop") {
        app.setFileOver(false);
        // Même dépôt livré deux fois : une seule fois.
        const sig = p.paths.join("\n");
        if (sig === lastDrop.sig && performance.now() - lastDrop.at < 500) return;
        lastDrop = { sig, at: performance.now() };
        if (!app.demo()) for (const path of p.paths) void app.addFolder(path);
      }
    });
    onCleanup(off);
  }

  // Le thème s'applique à toute la page (fond de fenêtre compris).
  createEffect(() => document.documentElement.setAttribute("data-theme", app.theme()));
  // Couleurs choisies dans les Réglages : posées sur la page et sur chaque élément qui redéclare le thème.
  const colorStyle = () => colorVars(app.colors());
  createEffect(() => {
    const root = document.documentElement.style;
    const vars = colorStyle();
    for (const v of COLOR_VARS) vars[v] ? root.setProperty(v, vars[v]) : root.removeProperty(v);
  });

  // Boutons « précédent / suivant » de la souris : même historique que ⌥← / ⌥→.
  function onMouseNav(e: MouseEvent) {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    e.button === 3 ? app.back() : app.forward();
  }

  onMount(() => {
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouseNav);
    // Une autre app passe devant (le DAW) : on coupe, si le réglage le demande.
    const onBlur = () => app.stopOnBlur() && app.playingId() !== null && app.stop();
    window.addEventListener("blur", onBlur);
    onCleanup(() => window.removeEventListener("blur", onBlur));
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouseNav);
    });
    void app.start().then((isDemo) => isDemo && runScenario(scenario()));
    if (inTauri) {
      listenFileDrops();
      void listenFocusSearch();
    }
  });

  const panel = () => <PanelShell searchRef={(el) => (search = el)} forceAc={acOpen()} />;

  return (
    <Show when={!inTauri} fallback={<div class="app-window">{panel()}</div>}>
      <div class="demo-page" data-theme={app.theme()} style={colorStyle()}>
        <DemoBar scenario={scenario()} onScenario={runScenario} />
        <div class="demo-stage">
          <div class="demo-window" data-theme={app.theme()} style={{ ...colorStyle(), width: `${app.width()}px` }}>
            <div class="demo-traffic" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            {panel()}
            <Show when={app.grid()}>
              <div class="demo-grid" />
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
