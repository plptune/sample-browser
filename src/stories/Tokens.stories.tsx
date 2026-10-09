import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Tokens } from "./Tokens";

const meta = {
  title: "Fondations/Tokens",
  component: Tokens,
  parameters: { panel: false, layout: "padded" },
} satisfies Meta<typeof Tokens>;

export default meta;

export const Planche: StoryObj<typeof meta> = {};
