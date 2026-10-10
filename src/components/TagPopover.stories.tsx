import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TagPopover } from "./TagPopover";

const meta = {
  title: "Composants/TagPopover",
  component: TagPopover,
  args: {
    count: 4,
    autofocus: false,
    tags: [
      { name: "punchy", state: "all" },
      { name: "dark", state: "some" },
      { name: "tape", state: "some" },
      { name: "warm", state: "none" },
      { name: "lofi", state: "none" },
      { name: "airy", state: "none" },
    ],
  },
  // Le popover se place sous le champ de recherche : la story réserve cette hauteur.
  parameters: { panelHeight: "320px" },
} satisfies Meta<typeof TagPopover>;

export default meta;

export const Selection: StoryObj<typeof meta> = {};
export const UnSample: StoryObj<typeof meta> = {
  args: { count: 1, tags: [{ name: "analog", state: "all" }, { name: "clean", state: "all" }, { name: "warm", state: "none" }] },
};
