// Bas du panneau : le sample courant et sa waveform, rien d'autre.
import { Show } from "solid-js";
import type { Sample } from "../api";
import { formatDuration } from "../lib/format";
import { IconButton } from "./IconButton";
import { Waveform } from "./Waveform";

export function PreviewDrawer(props: {
  sample?: Sample | null;
  /** Pics du sample (demandés à part : les lignes de l'arbre ne les transportent pas). Défaut : `sample.peaks`. */
  peaks?: number[];
  playing: boolean;
  progress: number;
  themeKey?: string;
  onTogglePlay?: () => void;
  onToggleFav?: () => void;
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
        {/* Favori : discret, gris, seulement ici (jamais dans les lignes de l'arbre). */}
        <Show when={s()}>
          <IconButton
            icon={s()!.fav ? "star-fill" : "star"}
            label={s()!.fav ? "Retirer des favoris (⌘D)" : "Ajouter aux favoris (⌘D)"}
            active={s()!.fav}
            onClick={() => props.onToggleFav?.()}
          />
        </Show>
      </div>
      <div class="cr-drawer__wave cr-wave">
        <Show when={s() && !s()!.missing}>
          <Waveform peaks={props.peaks ?? s()!.peaks} progress={props.playing ? props.progress : undefined} themeKey={props.themeKey} />
        </Show>
        <Show when={s()?.missing}>
          <div class="cr-drawer__error">Fichier introuvable</div>
        </Show>
      </div>
    </section>
  );
}
