import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { PanelShell } from "./components/PanelShell";
import { DemoBar } from "./demo/DemoBar";
import { SCENARIOS, acOpen } from "./demo/scenarios";
import { app } from "./state/app";

const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");

export function App() {
  const [scenario, setScenario] = createSignal(3);
  let search: HTMLInputElement | undefined;

  const runScenario = (id: number) => {
    setScenario(id);
    SCENARIOS.find((s) => s.id === id)?.run();
  };

  function onKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      search?.focus();
      return;
    }
    if (isField(e.target)) return;

    const tree = () => document.querySelector<HTMLElement>(".cr-tree");
    if (mod) return;

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
      case "Escape":
        app.stop();
        return;
      case "/":
        e.preventDefault();
        search?.focus();
        return;
    }
    const sc = SCENARIOS.find((s) => s.key === e.key);
    if (sc) runScenario(sc.id);
  }

  onMount(() => {
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
    });
    runScenario(scenario());
  });

  return (
    <>
      <div class="demo-page" data-theme={app.theme()}>
        <DemoBar scenario={scenario()} onScenario={runScenario} />
        <div class="demo-stage">
          <div class="demo-window" data-theme={app.theme()} style={{ width: `${app.width()}px` }}>
            <div class="demo-traffic" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <PanelShell searchRef={(el) => (search = el)} forceAc={acOpen()} />
            <Show when={app.grid()}>
              <div class="demo-grid" />
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}
