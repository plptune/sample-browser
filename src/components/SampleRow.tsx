import { Show } from "solid-js";
import type { Sample } from "../api";
import { Icon } from "./Icon";
import { Waveform } from "./Waveform";

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return s.toFixed(2);
  if (s < 60) return s.toFixed(1);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

export function SampleRow(props: {
  sample: Sample;
  selected?: boolean;
  playing?: boolean;
  progress?: number;
  wave?: boolean;
  dragging?: boolean;
  themeKey?: string;
  ref?: (el: HTMLDivElement) => void;
  onMouseDown?: (e: MouseEvent) => void;
  onDblClick?: () => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const s = () => props.sample;
  return (
    <div
      ref={props.ref}
      class="cr-row"
      role="option"
      aria-selected={!!props.selected}
      data-selected={props.selected || undefined}
      data-playing={props.playing || undefined}
      data-missing={s().missing || undefined}
      data-wave={props.wave || undefined}
      data-dragging={props.dragging || undefined}
      draggable={!s().missing}
      title={s().missing ? `Introuvable : ${s().path}` : s().path}
      onMouseDown={(e) => props.onMouseDown?.(e)}
      onDblClick={() => props.onDblClick?.()}
      onDragStart={(e) => props.onDragStart?.(e)}
      onDragEnd={() => props.onDragEnd?.()}
    >
      <span class="cr-col-state">
        <Show when={props.playing}>
          <Icon name="play" class="cr-row__playing" />
        </Show>
        <Show when={s().missing}>
          <span class="cr-row__warn">!</span>
        </Show>
      </span>
      <div class="cr-col-name cr-row__main">
        <span class="cr-row__name">
          {s().name}
        </span>
        <Show when={props.wave}>
          <Waveform
            class="cr-row__wave"
            variant="mini"
            peaks={s().peaks}
            progress={props.playing ? props.progress : undefined}
            themeKey={props.themeKey}
          />
        </Show>
      </div>
      <span class="cr-col-bpm cr-row__meta">{s().bpm ?? ""}</span>
      <span class="cr-col-key cr-row__meta">{s().key ?? ""}</span>
    </div>
  );
}
