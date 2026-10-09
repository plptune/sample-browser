// Scénarios de démo : chacun remet l'app dans un état précis et reproductible.
import { batch, createSignal } from "solid-js";
import { mockSetMissing } from "../api/mock";
import { SAMPLES } from "../mock/generate";
import { app } from "../state/app";

export interface Scenario {
  id: number;
  key: string; // raccourci clavier
  label: string;
  run: () => void | Promise<void>;
}

export const [acOpen, setAcOpen] = createSignal(false);
let timers: number[] = [];

/** Sélectionne la n-ième ligne sample dont le nom commence par `prefix`. */
function selectSample(prefix: string, nth = 0) {
  const row = app.visible().filter((r) => r.type === "sample" && r.sample.name.startsWith(prefix))[nth];
  if (row) app.select(row.key);
  return row?.type === "sample" ? row.sample : undefined;
}

async function reset(expanded: string[] = []) {
  timers.forEach(clearInterval);
  timers = [];
  app.stop();
  mockSetMissing([]);
  batch(() => {
    setAcOpen(false);
    app.setEmpty(false);
    app.setScan(null);
    app.setVisibleLimit(null);
    app.setChips([]);
    app.setDraft("");
    app.setExpanded(expanded);
    app.setSelection([]);
    app.setCursor(null);
    app.setCurrent(null);
    app.setAutoPlay(false);
    app.setDropTarget(null);
    app.setDensity("compact");
  });
  await Promise.all([app.refresh(), app.reloadLibrary()]);
}

export const SCENARIOS: Scenario[] = [
  {
    id: 1, key: "1", label: "Premier lancement",
    run: async () => {
      await reset();
      app.setEmpty(true);
    },
  },
  {
    id: 2, key: "2", label: "Indexation en cours",
    run: async () => {
      await reset(["f:10", "f:11", "f:12"]);
      const total = 3100;
      const steps = [3, 6, 12, 24, 999];
      let done = 380;
      let step = 0;
      app.setScan({ folder: "Samples", done, total });
      app.setVisibleLimit(steps[0]);
      timers.push(
        window.setInterval(() => {
          done = Math.min(total, done + 37);
          app.setScan({ folder: "Samples", done, total });
          const target = Math.floor((done / total) * steps.length);
          if (target > step && target < steps.length) {
            step = target;
            app.setVisibleLimit(steps[step]);
          }
          if (done >= total) {
            timers.forEach(clearInterval);
            app.setScan(null);
            app.setVisibleLimit(null);
          }
        }, 60),
      );
    },
  },
  {
    id: 3, key: "3", label: "Navigation",
    run: async () => {
      await reset(["f:10", "f:11", "f:12"]);
      selectSample("Kick", 3);
    },
  },
  {
    id: 4, key: "4", label: "Recherche active",
    run: async () => {
      await reset();
      app.setChips(["type:loop", "#lofi", "bpm:80-110"]);
      app.setDraft("#");
      await app.refresh();
      selectSample("Keys_Loop", 0);
      setAcOpen(true);
    },
  },
  {
    id: 5, key: "5", label: "Aucun résultat",
    run: async () => {
      await reset();
      app.setChips(["#airy", "bpm:>170"]);
      await app.refresh();
    },
  },
  {
    id: 6, key: "6", label: "Lecture",
    run: async () => {
      await reset(["g:collections", "c:1"]);
      const s = selectSample("Keys_Loop", 0);
      document.querySelector<HTMLElement>(".cr-tree")?.focus();
      if (s) app.play(s.id);
    },
  },
  {
    id: 10, key: "0", label: "Erreurs",
    run: async () => {
      const claps = SAMPLES.filter((s) => s.name.startsWith("Clap") && s.folderId === 13);
      await reset(["f:10", "f:11", "f:13", "f:20"]);
      mockSetMissing([claps[0].id, claps[2].id, claps[3].id]);
      await app.refresh();
      const row = app.visible().find((r) => r.type === "sample" && r.sample.id === claps[2].id);
      if (row) app.select(row.key);
    },
  },
  {
    id: 12, key: "=", label: "Mode waveform",
    run: async () => {
      await reset(["f:1", "f:2", "f:3"]);
      app.setDensity("wave");
      const s = selectSample("Drum_Loop", 0);
      if (s) app.play(s.id);
    },
  },
];
