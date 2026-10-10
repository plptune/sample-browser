import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { kick, loop, missing } from "../stories/fixtures";
import { TreeRow } from "./TreeRow";

const meta = {
  title: "Composants/TreeRow",
  component: TreeRow,
  args: { kind: "folder", label: "Drums", depth: 0 },
  argTypes: {
    kind: { control: "inline-radio", options: ["folder", "shortcut", "group", "favorites", "collection", "smart", "virtual", "sample"] },
    depth: { control: { type: "range", min: 0, max: 4 } },
    progress: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    marker: { control: "inline-radio", options: [undefined, "shortcut", "virtual", "collection", "favorites", "pin"] },
  },
  // Les lignes vivent dans un .cr-tree (fond, focus) ; l'arbre est « focus » pour montrer la sélection active.
  render: (args, ctx) => (
    <div class="cr-tree" data-focused style={{ flex: "none" }}>
      <TreeRow {...args} themeKey={String(ctx.globals.theme)} />
    </div>
  ),
} satisfies Meta<typeof TreeRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const sample = (s: typeof kick) => ({ kind: "sample" as const, label: s.name, depth: 1, bpm: s.bpm, keyName: s.key, peaks: s.peaks });

export const DossierFerme: Story = {};
export const DossierOuvert: Story = { args: { open: true } };
export const HorsLigne: Story = { args: { label: "Field Recordings", offline: true } };
export const CibleDeDepot: Story = { args: { kind: "virtual", label: "Drums", depth: 1, dropTarget: true } };
/** Sous-dossier épinglé dans Bibliothèque : pas de chevron, un clic saute au vrai dossier. */
export const Raccourci: Story = { args: { kind: "shortcut", label: "Dusty Tapes Vol.2", marker: "shortcut" } };
export const DossierVirtuelEpingle: Story = { args: { kind: "virtual", label: "Pack 2026", marker: "virtual" } };
export const CollectionEpinglee: Story = { args: { kind: "collection", label: "Go-to kicks", marker: "collection" } };
export const EpingleDansVirtuels: Story = { args: { kind: "virtual", label: "Pack 2026", marker: "pin" } };
export const Sample: Story = { args: sample(loop) };
export const Selectionne: Story = { args: { ...sample(kick), selected: true } };
export const EnLecture: Story = { args: { ...sample(loop), selected: true, playing: true, progress: 0.4 } };
export const Introuvable: Story = { args: { ...sample(missing), missing: true } };
export const Renommage: Story = { args: { kind: "virtual", label: "Nouveau dossier", depth: 1, renaming: true } };
export const EnDrag: Story = { args: { ...sample(kick), dragging: true } };
export const Waveform: Story = { args: { ...sample(loop), wave: true, playing: true, progress: 0.4 } };
/** Mode grand : colonnes durée, format et tags avant BPM / clé. */
export const Large: Story = {
  parameters: { panelWidth: "860px" },
  args: { ...sample(loop), wide: true, duration: "7.38", format: "wav · 44,1 kHz · 24 bits", tags: loop.tags },
};
/** Fichier MIDI : repère « MIDI » avant le BPM (joué au piano dans l'app). */
export const Midi: Story = { args: { kind: "sample", label: "Lofi_Chords_90_Am", depth: 1, midi: true, bpm: 90, keyName: "Am" } };

/** Onglet Bibliothèque : sources, puis éléments épinglés marqués à droite. */
export const Arbre: Story = {
  render: (_args, ctx) => (
    <div class="cr-tree" data-focused style={{ flex: "none" }}>
      <TreeRow kind="folder" label="Splice" depth={0} />
      <TreeRow kind="folder" label="Samples" depth={0} open />
      <TreeRow kind="folder" label="Drums" depth={1} open />
      <TreeRow kind="folder" label="Kicks" depth={2} />
      <TreeRow kind="sample" label={loop.name} depth={2} bpm={loop.bpm} keyName={loop.key} selected playing progress={0.4} themeKey={String(ctx.globals.theme)} />
      <TreeRow kind="sample" label={kick.name} depth={2} />
      <TreeRow kind="folder" label="Field Recordings" depth={0} offline />
      <TreeRow kind="shortcut" label="Dusty Tapes Vol.2" depth={0} marker="shortcut" />
      <TreeRow kind="favorites" label="Favoris" depth={0} marker="favorites" />
      <TreeRow kind="collection" label="Go-to kicks" depth={0} marker="collection" />
      <TreeRow kind="virtual" label="Pack 2026" depth={0} marker="virtual" />
    </div>
  ),
};

/** Onglet Virtuels : favoris, collections à plat, dossiers virtuels en arborescence. */
export const ArbreVirtuels: Story = {
  render: () => (
    <div class="cr-tree" data-focused style={{ flex: "none" }}>
      <TreeRow kind="favorites" label="Favoris" depth={0} marker="pin" />
      <TreeRow kind="group" label="Collections" depth={0} open />
      <TreeRow kind="collection" label="Go-to kicks" depth={1} marker="pin" />
      <TreeRow kind="smart" label="Loops en Am" depth={1} />
      <TreeRow kind="virtual" label="Pack 2026" depth={0} open marker="pin" />
      <TreeRow kind="virtual" label="Drums" depth={1} />
      <TreeRow kind="virtual" label="Textures" depth={1} />
      <TreeRow kind="sample" label="Riser_Punchy_01" depth={1} />
      <TreeRow kind="virtual" label="Projets" depth={0} />
    </div>
  ),
};
