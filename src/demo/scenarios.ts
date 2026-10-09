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

const firstId = (prefix: string, nth = 0) => SAMPLES.filter((s) => s.name.startsWith(prefix))[nth].id;

async function reset() {
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
    app.setSort("name");
    app.goTo({ type: "all" });
    app.setSelection([]);
    app.setCursor(null);
    app.setExpanded([]);
    app.setSidebarCollapsed(false);
    app.setOpenSections({ library: true, collections: true, sources: true });
    app.setAutoPlay(false);
    app.setDropTarget(null);
    app.setRenamingId(null);
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
      await reset();
      app.setOpenSections({ library: true, collections: false, sources: true });
      const total = 3100;
      const steps = [24, 60, 140, 260, 400];
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
      await reset();
      app.setOpenSections({ library: true, collections: false, sources: true });
      app.setExpanded([10, 11]);
      app.goTo({ type: "folder", id: 12 });
      await app.refresh();
      app.select(app.visible()[3].id);
    },
  },
  {
    id: 4, key: "4", label: "Recherche active",
    run: async () => {
      await reset();
      app.setChips(["type:loop", "#lofi", "bpm:80-110"]);
      app.setDraft("#");
      await app.refresh();
      app.select(app.visible()[1].id);
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
      await reset();
      app.setOpenSections({ library: true, collections: true, sources: false });
      app.goTo({ type: "collection", id: 1 });
      await app.refresh();
      const id = app.visible().find((s) => s.name.startsWith("Keys_Loop"))!.id;
      app.select(id);
      document.querySelector<HTMLElement>(".cr-list")?.focus();
      app.play(id);
    },
  },
  {
    id: 10, key: "0", label: "Erreurs",
    run: async () => {
      await reset();
      const missing = [firstId("Clap", 0), firstId("Clap", 2), firstId("Clap", 3)];
      mockSetMissing(missing);
      app.setOpenSections({ library: false, collections: false, sources: true });
      app.setExpanded([20]);
      app.setDraft("clap");
      await app.refresh();
      app.select(missing[0]);
    },
  },
  {
    id: 12, key: "=", label: "Mode waveform",
    run: async () => {
      await reset();
      app.setDensity("wave");
      app.setOpenSections({ library: true, collections: false, sources: false });
      app.goTo({ type: "folder", id: 3 });
      await app.refresh();
      const id = app.visible().find((s) => s.name.startsWith("Drum_Loop"))!.id;
      app.select(id);
      app.play(id);
    },
  },
];
