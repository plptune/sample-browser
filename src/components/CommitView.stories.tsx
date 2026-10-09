import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CommitView } from "./CommitView";

const plan = { files: 27, folders: 2, bytes: 49_100_000, missing: 0 };

const meta = {
  title: "Composants/CommitView",
  component: CommitView,
  args: {
    name: "Pack 2026",
    flat: false,
    destination: "~/Desktop/Pack 2026",
    options: { keepHierarchy: true, addAsSource: false },
    plan,
    status: "idle",
    progress: 0,
    result: null,
  },
  argTypes: {
    status: { control: "inline-radio", options: ["idle", "running", "done"] },
    progress: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
  },
  parameters: { panelHeight: "420px" },
} satisfies Meta<typeof CommitView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Options: Story = {};
export const CollectionAPlat: Story = {
  args: { name: "Go-to kicks", flat: true, options: { keepHierarchy: false, addAsSource: false }, plan: { files: 12, folders: 0, bytes: 3_400_000, missing: 2 } },
};
export const Copie: Story = { args: { status: "running", progress: 0.45 } };
export const Termine: Story = {
  args: { status: "done", progress: 1, result: { destination: "~/Desktop/Pack 2026", copied: 27, skipped: 0 } },
};
