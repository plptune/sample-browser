// Barre de démo : hors du panneau, hors design system. Sert uniquement à piloter le prototype.
import { For } from "solid-js";
import { app } from "../state/app";
import { SCENARIOS } from "./scenarios";

const WIDTHS = [260, 300, 380, 520];

export function DemoBar(props: { scenario: number; onScenario: (id: number) => void }) {
  return (
    <div class="demo-bar">
      <label class="demo-group">
        <span>Scénario</span>
        <select value={props.scenario} onChange={(e) => { props.onScenario(+e.currentTarget.value); e.currentTarget.blur(); }}>
          <For each={SCENARIOS}>{(s) => <option value={s.id}>{`${s.key} · ${s.label}`}</option>}</For>
        </select>
      </label>
      <div class="demo-group">
        <span>Thème</span>
        <button data-on={app.theme() === "dark" || undefined} onClick={() => app.setTheme("dark")}>Sombre</button>
        <button data-on={app.theme() === "light" || undefined} onClick={() => app.setTheme("light")}>Clair</button>
      </div>
      <div class="demo-group">
        <span>Largeur</span>
        <For each={WIDTHS}>
          {(w) => <button data-on={app.width() === w || undefined} onClick={() => app.setWidth(w)}>{w}</button>}
        </For>
      </div>
      <div class="demo-group">
        <span>Densité</span>
        <button data-on={app.density() === "compact" || undefined} onClick={() => app.setDensity("compact")}>Compacte</button>
        <button data-on={app.density() === "wave" || undefined} onClick={() => app.setDensity("wave")}>Waveform</button>
      </div>
      <label class="demo-group">
        <input type="checkbox" checked={app.grid()} onChange={(e) => app.setGrid(e.currentTarget.checked)} />
        <span>Grille 4 px</span>
      </label>
      <a class="demo-link" href="#/gallery">Galerie →</a>
    </div>
  );
}
