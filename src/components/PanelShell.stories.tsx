import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SCENARIOS, acOpen } from "../demo/scenarios";
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
    await SCENARIOS.find((s) => s.id === id)!.run();
  },
});

export const PremierLancement = scenario(1);
export const Indexation = scenario(2);
export const Navigation = scenario(3);
export const Recherche = scenario(4);
export const AucunResultat = scenario(5);
export const Lecture = scenario(6);
export const Erreurs = scenario(10);
export const ModeWaveform = scenario(12);
