import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { QueryChip } from "./QueryChip";

const meta = {
  title: "Composants/QueryChip",
  component: QueryChip,
  args: { raw: "#warm" },
  parameters: { panel: false },
} satisfies Meta<typeof QueryChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tag: Story = {};
export const Filtre: Story = { args: { raw: "bpm:120-128" } };
export const Tonalite: Story = { args: { raw: "key:Am" } };
export const Exclusion: Story = { args: { raw: "-#bright" } };
export const EnEdition: Story = { args: { raw: "type:loop", pending: true } };
