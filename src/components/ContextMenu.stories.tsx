import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ContextMenu } from "./ContextMenu";

const meta = {
  title: "Composants/ContextMenu",
  component: ContextMenu,
  args: { x: 24, y: 16, items: [] },
  parameters: { panelHeight: "300px" },
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sample: Story = {
  args: {
    items: [
      { label: "Lire", shortcut: "Espace" },
      { label: "Taguer 4 samples…", shortcut: "T" },
      { type: "separator" },
      { type: "header", label: "Ajouter à" },
      { label: "Night Drive" },
      { label: "Go-to kicks" },
      { type: "separator" },
      { label: "Révéler dans le Finder" },
      { label: "Copier le chemin" },
    ],
  },
};

export const Collection: Story = {
  args: {
    items: [
      { label: "Ouvrir", shortcut: "⏎" },
      { label: "Renommer" },
      { type: "separator" },
      { label: "Supprimer la collection", danger: true },
    ],
  },
};

export const Source: Story = {
  args: {
    items: [
      { label: "Ouvrir", shortcut: "⏎" },
      { label: "Révéler dans le Finder", disabled: true },
      { type: "separator" },
      { label: "Retirer la source", danger: true },
    ],
  },
};
