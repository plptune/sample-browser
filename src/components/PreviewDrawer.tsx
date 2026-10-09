// Bas du panneau : le sample courant et sa waveform, rien d'autre.
import { Show } from "solid-js";
import type { Sample } from "../api";
import { formatDuration } from "../lib/format";
import { IconButton } from "./IconButton";
import { Waveform } from "./Waveform";

export function PreviewDrawer(props: {
  sample?: Sample | null;
  playing: boolean;
  progress: number;
  themeKey?: string;
  onTogglePlay?: () => void;
}) {
  const s = () => props.sample;
  const time = () => {
    const x = s();
    if (!x) return "";
    return `${formatDuration(props.playing ? x.durationMs * props.progress : 0)} / ${formatDuration(x.durationMs)}`;
  };
  return (
    <section class="cr-drawer" aria-label="Aperçu" data-empty={!s() || undefined}>
      <div class="cr-drawer__head">
        <IconButton
          icon={props.playing ? "stop" : "play"}
          label={props.playing ? "Stop (espace)" : "Lire (espace)"}
          active={props.playing}
          accent
          disabled={!s() || s()!.missing}
          onClick={() => props.onTogglePlay?.()}
        />
        <span class="cr-drawer__title" title={s()?.path}>
          {s() ? s()!.name : "Aucun sample"}
        </span>
        <span class="cr-drawer__time">{time()}</span>
      </div>
      <div class="cr-drawer__wave cr-wave">
        <Show when={s() && !s()!.missing}>
          <Waveform peaks={s()!.peaks} progress={props.playing ? props.progress : undefined} themeKey={props.themeKey} />
        </Show>
        <Show when={s()?.missing}>
          <div class="cr-drawer__error">Fichier introuvable</div>
        </Show>
      </div>
    </section>
  );
}
