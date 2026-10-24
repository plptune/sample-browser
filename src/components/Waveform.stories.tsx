import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { midiNotes } from "../mock/generate";
import { kick, loop } from "../stories/fixtures";
import { Waveform } from "./Waveform";

const meta = {
  title: "Composants/Waveform",
  component: Waveform,
  args: { peaks: loop.peaks, progress: 0.4, variant: "full" },
  argTypes: {
    progress: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    variant: { control: "inline-radio", options: ["full", "mini"] },
    peaks: { control: false },
  },
  render: (args, ctx) => (
    <div class="cr-wave" style={{ height: args.variant === "mini" ? "var(--cr-wave-mini-h)" : "var(--cr-wave-h)", background: "var(--cr-bg)" }}>
      <Waveform {...args} themeKey={String(ctx.globals.theme)} />
    </div>
  ),
} satisfies Meta<typeof Waveform>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loop: Story = {};
export const OneShot: Story = { args: { peaks: kick.peaks, progress: undefined } };
export const Mini: Story = { args: { variant: "mini" } };
/** Fichier MIDI : ses notes en piano roll (hauteur × temps) à la place de l'onde. */
export const Midi: Story = { args: { loadNotes: () => Promise.resolve(midiNotes("Lofi_Chords_90_Am")!) } };
export const MidiMini: Story = { args: { variant: "mini", loadNotes: () => Promise.resolve(midiNotes("Melody_Loop_120_Em")!) } };
