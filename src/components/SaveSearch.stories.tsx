import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SaveSearch } from "./SaveSearch";

const meta = {
  title: "Composants/SaveSearch",
  component: SaveSearch,
  args: { value: "Courts & sombres", autofocus: false },
} satisfies Meta<typeof SaveSearch>;

export default meta;

export const Nommage: StoryObj<typeof meta> = {};
