import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ScanStatus } from "./ScanStatus";

const meta = {
  title: "Composants/ScanStatus",
  component: ScanStatus,
  args: { folder: "Samples", done: 1240, total: 3100 },
  argTypes: { done: { control: { type: "range", min: 0, max: 3100, step: 10 } } },
} satisfies Meta<typeof ScanStatus>;

export default meta;

export const EnCours: StoryObj<typeof meta> = {};
export const Debut: StoryObj<typeof meta> = { args: { done: 40 } };
