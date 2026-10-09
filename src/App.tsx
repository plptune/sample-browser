import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { PanelShell } from "./components/PanelShell";
import { DemoBar } from "./demo/DemoBar";
import { SCENARIOS, acOpen } from "./demo/scenarios";
import { app } from "./state/app";

const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");

import { inTauri } from "./lib/env";

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
    // Touches de scénario (démo) : actives dans toutes les vues.
    const sc = SCENARIOS.find((x) => x.key === e.key);
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
        app.right();
        return;
      case "ArrowLeft":
        e.preventDefault();
        tree()?.focus();
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

  // Le thème s'applique à toute la page (fond de fenêtre compris).
  createEffect(() => document.documentElement.setAttribute("data-theme", app.theme()));

  onMount(() => {
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
    runScenario(scenario());
  });

  const panel = () => <PanelShell searchRef={(el) => (search = el)} forceAc={acOpen()} />;

  return (
    <Show when={!inTauri} fallback={<div class="app-window">{panel()}</div>}>
      <div class="demo-page" data-theme={app.theme()}>
        <DemoBar scenario={scenario()} onScenario={runScenario} />
        <div class="demo-stage">
          <div class="demo-window" data-theme={app.theme()} style={{ width: `${app.width()}px` }}>
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
