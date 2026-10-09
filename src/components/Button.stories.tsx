import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "./Button";

const meta = {
  title: "Composants/Button",
  component: Button,
  args: { children: "Choisir…" },
  argTypes: { variant: { control: "inline-radio", options: ["secondary", "primary"] } },
  parameters: { panel: false },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Secondaire: Story = {};
export const Principal: Story = { args: { variant: "primary", children: "Créer le dossier" } };
export const Desactive: Story = { args: { variant: "primary", children: "Créer le dossier", disabled: true } };
