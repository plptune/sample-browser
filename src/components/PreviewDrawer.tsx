import { For, Show } from "solid-js";
import type { Sample } from "../api";
import { IconButton } from "./IconButton";
import { formatDuration } from "./SampleRow";
import { TagPill } from "./TagPill";
import { Waveform } from "./Waveform";

export function PreviewDrawer(props: {
  sample?: Sample;
  selectedCount: number;
  playing: boolean;
  progress: number;
  autoPlay: boolean;
  themeKey?: string;
  onTogglePlay?: () => void;
  onToggleAuto?: () => void;
  onToggleFav?: () => void;
}) {
  const s = () => props.sample;
  const elapsed = () => (s() ? formatDuration(props.playing ? s()!.durationMs * props.progress : 0) : "");
  return (
    <section class="cr-drawer" aria-label="Aperçu">
      <Show
        when={s() && props.selectedCount <= 1}
        fallback={
          <div class="cr-drawer__multi">
            {props.selectedCount > 1 ? `${props.selectedCount} samples sélectionnés` : "Aucune sélection"}
          </div>
        }
      >
        <div class="cr-drawer__head">
          <IconButton
            icon={props.playing ? "stop" : "play"}
            label={props.playing ? "Stop (espace)" : "Lire (espace)"}
            active={props.playing}
            accent
            disabled={s()!.missing}
            onClick={() => props.onTogglePlay?.()}
          />
          <span class="cr-drawer__title">{s()!.name}</span>
          <span class="cr-drawer__time">
            {elapsed()} / {formatDuration(s()!.durationMs)}
          </span>
          <IconButton icon="loop" label="Lecture auto à la sélection" active={props.autoPlay} onClick={() => props.onToggleAuto?.()} />
        </div>
        <div class="cr-drawer__wave cr-wave">
          <Waveform peaks={s()!.peaks} progress={props.playing ? props.progress : undefined} themeKey={props.themeKey} />
        </div>
        <Show when={s()!.missing}>
          <div class="cr-drawer__error" title={s()!.path}>
            Fichier introuvable · {s()!.path}
          </div>
        </Show>
        <div class="cr-drawer__meta">
          <span>{s()!.kind === "loop" ? "Loop" : "One-shot"}</span>
          <Show when={s()!.bpm}><span>{s()!.bpm} BPM</span></Show>
          <Show when={s()!.key}><span>{s()!.key}</span></Show>
          <span>{s()!.channels === 1 ? "Mono" : "Stéréo"}</span>
        </div>
        <div class="cr-drawer__tags">
          <For each={s()!.tags}>{(t) => <TagPill name={t} />}</For>
          <TagPill name="" variant="add" />
        </div>
      </Show>
    </section>
  );
}
