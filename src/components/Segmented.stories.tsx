import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Segmented } from "./Segmented";

const meta = {
  title: "Composants/Segmented",
  component: Segmented,
  args: {
    label: "Thème",
    value: "dark",
    options: [
      { value: "dark", label: "Sombre" },
      { value: "light", label: "Clair" },
      { value: "system", label: "Système" },
    ],
  },
  parameters: { panel: false },
} satisfies Meta<typeof Segmented<string>>;

export default meta;

export const Theme: StoryObj<typeof meta> = {};
