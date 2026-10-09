import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { kick, loop, missing } from "../stories/fixtures";
import { PreviewDrawer } from "./PreviewDrawer";

const meta = {
  title: "Composants/PreviewDrawer",
  component: PreviewDrawer,
  args: { sample: kick, playing: false, progress: 0 },
  argTypes: { progress: { control: { type: "range", min: 0, max: 1, step: 0.01 } }, sample: { control: false } },
  render: (args, ctx) => <PreviewDrawer {...args} themeKey={String(ctx.globals.theme)} />,
} satisfies Meta<typeof PreviewDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vide: Story = { args: { sample: null } };
export const Arret: Story = {};
export const Lecture: Story = { args: { sample: loop, playing: true, progress: 0.4 } };
export const Favori: Story = { args: { sample: { ...kick, fav: true } } };
export const Introuvable: Story = { args: { sample: missing } };
