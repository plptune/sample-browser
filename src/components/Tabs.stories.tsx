import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Tabs } from "./Tabs";

const meta = {
  title: "Composants/Tabs",
  component: Tabs,
  args: {
    value: "library",
    items: [
      { value: "library", label: "Bibliothèque", shortcut: "⌘1", icon: "folder" },
      { value: "virtual", label: "Virtuels", shortcut: "⌘2", icon: "virtual" },
    ],
  },
  // Les onglets vivent dans la barre titre (72 px réservés aux feux macOS).
  render: (args) => (
    <header class="cr-titlebar">
      <Tabs {...args} />
      <span class="cr-titlebar__fill" />
    </header>
  ),
} satisfies Meta<typeof Tabs<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bibliotheque: Story = {};
export const Virtuels: Story = { args: { value: "virtual" } };
/** Colonne étroite : icônes seules, le nom reste dans l'infobulle. */
export const Icones: Story = { args: { iconOnly: true } };
