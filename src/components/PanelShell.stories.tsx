import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SCENARIOS, acOpen } from "../demo/scenarios";
import { app } from "../state/app";
import { PanelShell } from "./PanelShell";

// Le panneau complet, piloté par les mêmes scénarios que le prototype.
const meta = {
  title: "Écrans/Panneau",
  id: "ecrans-panneau",
  component: PanelShell,
  parameters: { panelHeight: "720px" },
  render: () => <PanelShell forceAc={acOpen()} />,
} satisfies Meta<typeof PanelShell>;

export default meta;
type Story = StoryObj<typeof meta>;

const scenario = (id: number): Story => ({
  name: SCENARIOS.find((s) => s.id === id)!.label,
  // Lancé après le montage : certains scénarios focalisent l'arbre ou lancent la lecture.
  play: async () => {
    // L'état de l'app est partagé d'une story à l'autre : on repart en mode colonne.
    if (app.layout() !== "side") await app.toggleLayout();
    await SCENARIOS.find((s) => s.id === id)!.run();
  },
});

export const PremierLancement = scenario(1);
export const Indexation = scenario(2);
export const Navigation = scenario(3);
export const Recherche = scenario(4);
export const AucunResultat = scenario(5);
export const Lecture = scenario(6);
export const Tagging = scenario(7);
export const Collections = scenario(8);
export const DragEnCours = scenario(9);
export const Erreurs = scenario(10);
export const Reglages = scenario(11);
export const ModeWaveform = scenario(12);
export const DossiersVirtuels = scenario(13);
export const CreerUnVraiDossier = scenario(14);

/** Fenêtre bibliothèque (⌘⇧F) : panneaux Library et Virtual empilés, preview, recherche et liste triable ; la chip
 *  `path:` part du dossier du sample sélectionné. */
export const FenetreBibliotheque: Story = {
  name: "Fenêtre bibliothèque",
  parameters: { panelWidth: "1200px" },
  play: async () => {
    await SCENARIOS.find((s) => s.id === 3)!.run();
    if (app.layout() !== "full") await app.toggleLayout();
    app.setPanelShown("library", true);
    app.setPanelShown("virtual", true);
  },
};

/** Fenêtre bibliothèque avec le seul panneau Virtual (⌘1 a masqué Library) : il prend toute la hauteur. */
export const FenetreBibliothequeVirtual: Story = {
  name: "Fenêtre bibliothèque, panneau Virtual seul",
  parameters: { panelWidth: "1200px" },
  play: async () => {
    await SCENARIOS.find((s) => s.id === 3)!.run();
    if (app.layout() !== "full") await app.toggleLayout();
    app.setPanelShown("virtual", true);
    app.setPanelShown("library", false);
  },
};
