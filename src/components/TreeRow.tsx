// Une ligne de l'arbre : dossier (chevron) ou sample (▶ quand lu). Même hauteur, même grille.
import { Show, onMount } from "solid-js";
import { Chevron, Icon } from "./Icon";
import { Waveform } from "./Waveform";

export type TreeRowKind = "folder" | "group" | "collection" | "smart" | "sample";

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
  dropTarget?: boolean;
  dragging?: boolean;
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
  return (
    <div
      ref={props.ref}
      class="cr-node"
      role="treeitem"
      aria-selected={!!props.selected}
      aria-expanded={isSample() ? undefined : !!props.open}
      aria-level={props.depth + 1}
      style={{ "--depth": props.depth }}
      data-kind={props.kind}
      data-selected={props.selected || undefined}
      data-playing={props.playing || undefined}
      data-missing={props.missing || undefined}
      data-offline={props.offline || undefined}
      data-drop-target={props.dropTarget || undefined}
      data-dragging={props.dragging || undefined}
      data-wave={(isSample() && props.wave) || undefined}
      draggable={isSample() && !props.missing}
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
          if (isSample()) return;
          e.stopPropagation();
          props.onToggle?.();
        }}
      >
        <Show when={!isSample()}>
          <Chevron open={props.open} />
        </Show>
        <Show when={props.playing}>
          <Icon name="play" class="cr-node__playing" />
        </Show>
        <Show when={props.missing}>
          <span class="cr-node__warn">!</span>
        </Show>
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
        <span class="cr-node__badge">hors ligne</span>
      </Show>
      <Show when={isSample()}>
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
      aria-label="Nouveau nom"
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
