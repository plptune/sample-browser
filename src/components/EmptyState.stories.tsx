import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Composants/EmptyState",
  component: EmptyState,
  args: { variant: "drop", title: "Glissez un dossier ici", body: "Crate indexe vos samples sans les déplacer." },
  argTypes: { variant: { control: "inline-radio", options: ["drop", "noresults"] } },
  parameters: { panelHeight: "320px" },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PremierLancement: Story = {};
export const DossierSurvole: Story = { args: { title: "Relâchez pour ajouter", body: undefined, over: true } };
export const AucunResultat: Story = {
  args: {
    variant: "noresults",
    title: "Aucun résultat",
    body: "Rien ne correspond à « #airy bpm:>170 ».",
    hints: ["kick dark", "#warm -#bright", "bpm:120-128 key:Am"],
  },
};
