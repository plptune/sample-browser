import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettingsView } from "./SettingsView";

const meta = {
  title: "Composants/SettingsView",
  component: SettingsView,
  args: {
    sources: [
      { id: 1, name: "Splice", path: "~/Splice/sounds", offline: false },
      { id: 10, name: "Samples", path: "~/Music/Samples", offline: false },
      { id: 20, name: "Field Recordings", path: "/Volumes/Field SSD", offline: true },
    ],
    theme: "dark",
    density: "compact",
    alwaysOnTop: true,
    autoPlay: true,
    initialTab: "sources",
    fontSize: "base",
    colors: { accent: "#e8a33d", bg: "#232323" },
    customColors: {},
    synonyms: [
      ["kick", "bd", "bassdrum"],
      ["snare", "sd"],
      ["hat", "hh", "hihat"],
    ],
  },
  argTypes: {
    theme: { control: "inline-radio", options: ["dark", "light", "system"] },
    density: { control: "inline-radio", options: ["compact", "wave"] },
  },
  parameters: { panelHeight: "520px" },
} satisfies Meta<typeof SettingsView>;

export default meta;

export const Reglages: StoryObj<typeof meta> = {};

/** Thème, densité, taille du texte (S / M / L) et les trois couleurs de base. */
export const Apparence: StoryObj<typeof meta> = { args: { initialTab: "appearance" } };

/** Une couleur changée : bouton × pour la rétablir, et « Rétablir toutes les couleurs ». */
export const CouleurModifiee: StoryObj<typeof meta> = {
  args: { initialTab: "appearance", fontSize: "lg", colors: { accent: "#2fae6a", bg: "#232323" }, customColors: { accent: "#2fae6a" } },
};

/** Lecture, avec « Depuis le DAW » : ⌘F pris seulement dans Live et Bitwig. */
export const Lecture: StoryObj<typeof meta> = {
  args: {
    initialTab: "playback",
    dawShortcut: { enabled: true, shortcut: "Cmd+KeyF", apps: ["com.ableton.live", "com.bitwig.studio"], keepDawActive: true, resizeTogether: false },
  },
};
export const Recherche: StoryObj<typeof meta> = { args: { initialTab: "search" } };

/** Analyse de fond en cours (tempo, tonalité) : une ligne discrète sous les sources. */
export const AnalyseEnCours: StoryObj<typeof meta> = {
  args: { initialTab: "sources", analysis: { done: 12_480, total: 41_250 } },
};

/** Tags Splice synchronisés : bilan sous les boutons. */
export const SpliceSynchronise: StoryObj<typeof meta> = {
  args: { initialTab: "sources", spliceSync: { status: "done", report: { spliceSamples: 13_459, matched: 12_870, added: 41_200 } } },
};

/** Splice absent de ce Mac : le message à la place du bilan. */
export const SpliceIntrouvable: StoryObj<typeof meta> = {
  args: { initialTab: "sources", spliceSync: { status: "error", error: "Splice not found on this Mac" } },
};
