import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TagPill } from "./TagPill";

const meta = {
  title: "Composants/TagPill",
  component: TagPill,
  args: { name: "warm" },
  parameters: { panel: false },
} satisfies Meta<typeof TagPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};
export const Actif: Story = { args: { active: true } };
export const Ajout: Story = { args: { variant: "add" } };
