// Mode grand : le sample courant, au-dessus de la recherche et de la liste (remplace le tiroir de la colonne).
// Lecture, nom, favori, métadonnées, grande waveform, tags modifiables, collections et dossiers virtuels qui le
// contiennent, chemin. Toujours à la même hauteur : la liste ne saute pas quand on change de sample.
import { For, Show } from "solid-js";
import type { NodeKey, Sample, Waveform as WaveformData } from "../api";
import { formatChannels, formatDuration, formatFormat, isMidi } from "../lib/format";
import type { AcItem } from "./Autocomplete";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { DrawerTags } from "./PreviewDrawer";
import { Waveform } from "./Waveform";

export function PreviewHeader(props: {
  sample?: Sample | null;
  /** Pics du sample (demandés à part). Défaut : `sample.peaks`. */
  peaks?: number[];
  /** Forme d'onde détaillée à la largeur affichée (Rust) ; sinon les 256 pics. */
  loadDetail?: (buckets: number) => Promise<WaveformData>;
  looping?: boolean;
  playing: boolean;
  progress: number;
  themeKey?: string;
  /** Samples sélectionnés : au-delà d'un, tags et favori s'appliquent à toute la sélection. */
  selectionCount?: number;
  /** Chemin du sample relatif à sa source : jamais de chemin absolu à l'écran. */
  relPath?: string;
  /** Collections manuelles et dossiers virtuels qui contiennent le sample. */
  memberships?: { key: NodeKey; name: string }[];
  /** Tags existants de la bibliothèque, proposés pendant la frappe. */
  knownTags?: AcItem[];
  onTogglePlay?: () => void;
  onToggleFav?: () => void;
  onSeek?: (fraction: number) => void;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  onTagsDone?: () => void;
  onJump?: (key: NodeKey) => void;
  onReveal?: () => void;
}) {
  const s = () => props.sample;
  const time = () => {
    const x = s()!;
    return `${formatDuration(props.playing ? x.durationMs * props.progress : 0)} / ${formatDuration(x.durationMs)}`;
  };
  const kind = () => {
    const x = s()!;
    const k = x.kind === "loop" ? "loop" : "one-shot";
    return isMidi(x) ? `MIDI · ${k}` : k === "loop" ? "Loop" : "One-shot";
  };
  return (
    <section class="cr-preview" aria-label="Preview" data-empty={!s() || undefined}>
      <Show when={s()} fallback={<div class="cr-preview__empty">Pick a sample</div>}>
        {(x) => (
          <>
            <div class="cr-preview__head">
              <IconButton
                icon={props.playing ? "stop" : "play"}
                label={props.playing ? "Stop (Space)" : "Play (Space)"}
                active={props.playing}
                accent
                disabled={x().missing}
                onClick={() => props.onTogglePlay?.()}
              />
              <span class="cr-preview__title" title={props.relPath}>
                {`${x().name}.${x().ext}`}
              </span>
              <IconButton
                icon={x().fav ? "star-fill" : "star"}
                label={x().fav ? "Remove from favorites (⌘D)" : "Add to favorites (⌘D)"}
                active={x().fav}
                onClick={() => props.onToggleFav?.()}
              />
              <span class="cr-preview__time cr-num">{time()}</span>
              <dl class="cr-preview__meta">
                <dt>BPM</dt>
                <dd class="cr-num">{x().bpm ?? "—"}</dd>
                <dt>Key</dt>
                <dd>{x().key ?? "—"}</dd>
                <dt>Type</dt>
                <dd>{kind()}</dd>
                <dt>Format</dt>
                <dd>
                  {formatFormat(x())}
                  <Show when={formatChannels(x().channels)}>{(c) => ` · ${c()}`}</Show>
                </dd>
              </dl>
            </div>

            <div class="cr-preview__wave cr-wave">
              <Show when={!x().missing} fallback={<div class="cr-drawer__error">File not found</div>}>
                <Waveform
                  peaks={props.peaks ?? x().peaks}
                  progress={props.playing ? props.progress : undefined}
                  themeKey={props.themeKey}
                  onSeek={props.onSeek}
                  loadDetail={props.loadDetail}
                  detailKey={x().id}
                  durationMs={x().durationMs}
                  looping={props.looping}
                />
              </Show>
            </div>

            <div class="cr-preview__foot">
              <DrawerTags
                kind={x().kind}
                tags={x().tags}
                autoTags={x().autoTags}
                known={props.knownTags ?? []}
                onAdd={(t) => props.onAddTag?.(t)}
                onRemove={(t) => props.onRemoveTag?.(t)}
                onDone={props.onTagsDone}
              />
              <Show when={(props.selectionCount ?? 1) > 1}>
                <span class="cr-preview__note">
                  {props.selectionCount} selected: tags and favorite apply to all.
                </span>
              </Show>
            </div>
            <div class="cr-preview__where">
              <Show when={props.memberships?.length}>
                <span class="cr-preview__label">In:</span>
                <For each={props.memberships}>
                  {(m) => (
                    <button class="cr-preview__link" onClick={() => props.onJump?.(m.key)}>
                      <Icon name={m.key.startsWith("v:") ? "virtual" : "collection"} />
                      {m.name}
                    </button>
                  )}
                </For>
              </Show>
              {/* Relatif à la source, tronqué par le début (le dossier et le fichier restent visibles) ; le chemin
                  lui-même reste de gauche à droite. */}
              <span class="cr-preview__path" title={props.relPath}>
                <bdi>{props.relPath ?? ""}</bdi>
              </span>
              <Button onClick={() => props.onReveal?.()}>Show in Finder</Button>
            </div>
          </>
        )}
      </Show>
    </section>
  );
}
