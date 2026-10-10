import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { app } from "../state/app";
import { SearchField } from "./SearchField";

// SearchField est branché sur l'état de l'app : chaque story le prépare avant le rendu.
const meta = {
  title: "Composants/SearchField",
  component: SearchField,
  loaders: [() => app.reloadLibrary()],
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

const withQuery = (chips: string[], draft: string) => () => {
  app.setChips(chips);
  app.setDraft(draft);
};

export const Vide: Story = { beforeEach: withQuery([], "") };
export const Texte: Story = { beforeEach: withQuery([], "kick dus") };
export const Chips: Story = { beforeEach: withQuery(["#warm", "bpm:120-128", "-#bright"], "kick") };
export const Autocompletion: Story = {
  beforeEach: withQuery(["type:loop"], "#"),
  args: { forceAc: true },
  parameters: { panelHeight: "260px" },
};
