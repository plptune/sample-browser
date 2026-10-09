import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettingsView } from "./SettingsView";

const meta = {
  title: "Composants/SettingsView",
  component: SettingsView,
  args: {
    sources: [
      { id: 1, name: "Splice", path: "~/Splice/sounds", offline: false },
      { id: 10, name: "Samples", path: "~/Music/Samples", offline: false },
      { id: 20, name: "Field Recordings", path: "/Volumes/Field SSD", offline: true },
    ],
    theme: "dark",
    density: "compact",
    alwaysOnTop: true,
    autoPlay: false,
  },
  argTypes: {
    theme: { control: "inline-radio", options: ["dark", "light", "system"] },
    density: { control: "inline-radio", options: ["compact", "wave"] },
  },
  parameters: { panelHeight: "520px" },
} satisfies Meta<typeof SettingsView>;

export default meta;

export const Reglages: StoryObj<typeof meta> = {};
