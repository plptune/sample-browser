// Une ligne de l'arbre : dossier (chevron) ou sample (▶ quand lu), puis l'icône de type. Même hauteur, même grille.
import { Show, onMount } from "solid-js";
import { Chevron, Icon, type IconName } from "./Icon";
import { Waveform } from "./Waveform";

export type TreeRowKind = "folder" | "shortcut" | "group" | "favorites" | "collection" | "smart" | "virtual" | "sample";

/** Repère discret à droite : nature d'un élément épinglé (onglet Bibliothèque) ou épinglage (onglet Virtuels). */
export type TreeRowMarker = "shortcut" | "virtual" | "collection" | "favorites" | "pin";

const MARKER_ICON = { shortcut: "alias", virtual: "virtual", collection: "collection", favorites: "star", pin: "pin" } as const;
/** Icône de type devant le libellé. */
const KIND_ICON: Record<Exclude<TreeRowKind, "sample">, IconName> = {
  folder: "folder",
  shortcut: "folder",
  group: "folder",
  favorites: "star",
  collection: "collection",
  smart: "search",
  virtual: "virtual",
};

const MARKER_LABEL = {
  shortcut: "Shortcut to a folder",
  virtual: "Virtual folder",
  collection: "Collection",
  favorites: "Favorites",
  pin: "Shown in Library",
} as const;

export function TreeRow(props: {
  kind: TreeRowKind;
  label: string;
  depth: number;
  open?: boolean;
  selected?: boolean;
  playing?: boolean;
  progress?: number;
  missing?: boolean;
  offline?: boolean;
  /** Dossier aplati (filtre temporaire) : icône de dossier à astérisque, en couleur primaire. */
  flattened?: boolean;
  /** Masqué (visible seulement avec « is:hidden ») : atténué. */
  hidden?: boolean;
  marker?: TreeRowMarker;
  draggable?: boolean;
  dropTarget?: boolean;
  dragging?: boolean;
  /** Fichier MIDI (joué au piano dans l'app) : icône de note au lieu de l'onde. */
  midi?: boolean;
  /** Mode grand : colonnes durée, format et tags avant BPM / clé. */
  wide?: boolean;
  duration?: string;
  format?: string;
  tags?: string[];
  bpm?: number | null;
  keyName?: string | null;
  peaks?: number[];
  wave?: boolean;
  themeKey?: string;
  title?: string;
  renaming?: boolean;
  onRename?: (name: string) => void;
  ref?: (el: HTMLDivElement) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onMouseDown?: (e: MouseEvent) => void;
  onDblClick?: () => void;
  onToggle?: () => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
}) {
  const isSample = () => props.kind === "sample";
  // Un raccourci ne se déplie pas (il saute au dossier visé) : pas de chevron.
  const folds = () => !isSample() && props.kind !== "shortcut";
  const kindIcon = (): IconName =>
    props.kind === "sample" ? (props.midi ? "midi" : "sample") : props.flattened ? "folder-flat" : KIND_ICON[props.kind];
  return (
    <div
      ref={props.ref}
      class="cr-node"
      role="treeitem"
      aria-selected={!!props.selected}
      aria-expanded={folds() ? !!props.open : undefined}
      aria-level={props.depth + 1}
      style={{ "--depth": props.depth }}
      data-kind={props.kind}
      data-selected={props.selected || undefined}
      data-playing={props.playing || undefined}
      data-missing={props.missing || undefined}
      data-hidden={props.hidden || undefined}
      data-flattened={props.flattened || undefined}
      data-offline={props.offline || undefined}
      data-drop-target={props.dropTarget || undefined}
      data-dragging={props.dragging || undefined}
      data-wave={(isSample() && props.wave) || undefined}
      draggable={props.draggable ?? (isSample() && !props.missing)}
      title={props.title}
      onMouseDown={(e) => props.onMouseDown?.(e)}
      onDblClick={() => props.onDblClick?.()}
      onContextMenu={(e) => {
        if (!props.onContextMenu) return;
        e.preventDefault();
        props.onContextMenu(e);
      }}
      onDragStart={(e) => props.onDragStart?.(e)}
      onDragEnd={() => props.onDragEnd?.()}
      onDragOver={(e) => props.onDragOver?.(e)}
      onDragLeave={() => props.onDragLeave?.()}
      onDrop={(e) => props.onDrop?.(e)}
    >
      {/* Emplacement fixe : chevron (dossier), ▶ (lecture), ! (introuvable) ou vide. */}
      <span
        class="cr-node__slot"
        onMouseDown={(e) => {
          if (!folds()) return;
          e.stopPropagation();
          props.onToggle?.();
        }}
      >
        <Show when={folds()}>
          <Chevron open={props.open} />
        </Show>
        <Show when={props.playing}>
          <Icon name="play" class="cr-node__playing" />
        </Show>
        <Show when={props.missing}>
          <span class="cr-node__warn">!</span>
        </Show>
      </span>
      <span class="cr-node__icon" data-icon={kindIcon()}>
        <Icon name={kindIcon()} />
      </span>
      <div class="cr-node__main">
        <Show when={props.renaming} fallback={<span class="cr-node__label">{props.label}</span>}>
          <RenameInput value={props.label} onDone={(v) => props.onRename?.(v)} />
        </Show>
        <Show when={isSample() && props.wave && props.peaks}>
          <Waveform
            class="cr-node__wave"
            variant="mini"
            peaks={props.peaks!}
            progress={props.playing ? props.progress : undefined}
            themeKey={props.themeKey}
          />
        </Show>
      </div>
      <Show when={props.offline}>
        <span class="cr-node__badge">offline</span>
      </Show>
      <Show when={props.marker}>
        {(m) => (
          <span class="cr-node__marker" title={MARKER_LABEL[m()]} aria-label={MARKER_LABEL[m()]}>
            <Icon name={MARKER_ICON[m()]} />
          </span>
        )}
      </Show>
      <Show when={isSample() && props.wide}>
        <span class="cr-col-dur cr-node__meta">{props.duration ?? ""}</span>
        <span class="cr-col-fmt cr-node__meta">{props.format ?? ""}</span>
        <span class="cr-col-tags" title={props.tags?.join(", ")}>
          {props.tags?.join(" · ") ?? ""}
        </span>
      </Show>
      {/* En colonne : juste l'icône et le nom ; les métadonnées n'apparaissent qu'en mode grand. */}
      <Show when={isSample() && props.wide}>
        <span class="cr-col-bpm cr-node__meta">{props.bpm ?? ""}</span>
        <span class="cr-col-key cr-node__meta">{props.keyName ?? ""}</span>
      </Show>
    </div>
  );
}

/** Renommage en place : ⏎ valide, Échap annule, perte de focus valide. */
function RenameInput(props: { value: string; onDone: (v: string) => void }) {
  let input!: HTMLInputElement;
  let done = false;
  const finish = (v: string) => {
    if (done) return;
    done = true;
    props.onDone(v);
  };
  onMount(() => {
    input.focus({ preventScroll: true });
    input.select();
  });
  return (
    <input
      ref={input}
      class="cr-node__input"
      value={props.value}
      spellcheck={false}
      aria-label="New name"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(input.value);
        if (e.key === "Escape") finish(props.value);
      }}
      onBlur={() => finish(input.value)}
    />
  );
}
