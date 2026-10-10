import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Toggle } from "./Toggle";

const meta = {
  title: "Composants/Toggle",
  component: Toggle,
  args: { checked: false, label: "Toujours au premier plan" },
  parameters: { panel: false },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { checked: true } };
