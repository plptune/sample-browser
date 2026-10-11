import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SAMPLES } from "../mock/generate";
import { kick, loop, missing } from "../stories/fixtures";
import { PreviewHeader } from "./PreviewHeader";

const midi = SAMPLES.find((s) => s.ext === "mid")!;

const meta = {
  title: "Composants/PreviewHeader",
  component: PreviewHeader,
  args: {
    sample: loop,
    playing: false,
    progress: 0,
    memberships: [
      { key: "c:3", name: "Loops in Am" },
      { key: "v:4", name: "Drums" },
    ],
    knownTags: [{ label: "dark", count: 12 }, { label: "dusty", count: 4 }],
  },
  argTypes: { progress: { control: { type: "range", min: 0, max: 1, step: 0.01 } } },
  // Haut de la partie droite de la fenêtre bibliothèque.
  parameters: { panelWidth: "860px", panelHeight: "200px" },
  render: (args, ctx) => <PreviewHeader {...args} themeKey={String(ctx.globals.theme)} />,
} satisfies Meta<typeof PreviewHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Boucle: Story = {};
export const EnLecture: Story = { args: { playing: true, progress: 0.4 } };
export const OneShot: Story = { args: { sample: kick, memberships: [{ key: "c:1", name: "Go-to kicks" }] } };
export const Midi: Story = { args: { sample: midi, memberships: [] } };
export const SelectionMultiple: Story = { args: { selectionCount: 5 } };
export const Introuvable: Story = { args: { sample: missing, memberships: [] } };
export const Vide: Story = { args: { sample: null } };
