import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Autocomplete } from "./Autocomplete";

const meta = {
  title: "Composants/Autocomplete",
  component: Autocomplete,
  args: {
    items: [
      { label: "#warm", count: 84 },
      { label: "#wide", count: 61 },
      { label: "#lofi", count: 57 },
      { label: "#tape", count: 40 },
    ],
    active: 1,
    onPick: () => {},
  },
  render: (args) => (
    <div style={{ position: "relative", height: "140px" }}>
      <Autocomplete {...args} />
    </div>
  ),
} satisfies Meta<typeof Autocomplete>;

export default meta;

export const Ouverte: StoryObj<typeof meta> = {};
