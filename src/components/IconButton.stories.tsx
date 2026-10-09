import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconButton } from "./IconButton";

const meta = {
  title: "Composants/IconButton",
  component: IconButton,
  args: { icon: "play", label: "Lire" },
  argTypes: {
    icon: { control: "select", options: ["search", "chevron", "play", "stop", "close", "plus", "settings", "sidebar", "loop"] },
  },
  parameters: { panel: false },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};
export const Actif: Story = { args: { icon: "loop", label: "Auto-play", active: true } };
export const ActifAccent: Story = { args: { icon: "stop", label: "Stop", active: true, accent: true } };
export const Desactive: Story = { args: { disabled: true } };
