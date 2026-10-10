// Mode grand : le sample courant en détail, à droite de l'arbre (remplace le tiroir du mode colonne).
// Grande waveform, lecture, métadonnées, tags modifiables, collections et dossiers virtuels qui le contiennent.
import { For, Show } from "solid-js";
import type { NodeKey, Sample } from "../api";
import { formatChannels, formatDuration, formatFormat, isMidi } from "../lib/format";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Waveform } from "./Waveform";

export function Inspector(props: {
  sample?: Sample | null;
  /** Pics du sample (demandés à part). Défaut : `sample.peaks`. */
  peaks?: number[];
  playing: boolean;
  progress: number;
  themeKey?: string;
  /** Samples sélectionnés : au-delà d'un, tags et favori s'appliquent à toute la sélection. */
  selectionCount?: number;
  /** Collections manuelles et dossiers virtuels qui contiennent le sample. */
  memberships?: { key: NodeKey; name: string }[];
  onTogglePlay?: () => void;
  onToggleFav?: () => void;
  onSeek?: (fraction: number) => void;
  onRemoveTag?: (tag: string) => void;
  onAddTag?: () => void;
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
    const k = x.kind === "loop" ? "boucle" : "one-shot";
    return isMidi(x) ? `MIDI · ${k}` : k === "boucle" ? "Boucle" : "One-shot";
  };
  return (
    <aside class="cr-inspector" aria-label="Inspecteur">
      <Show when={s()} fallback={<div class="cr-inspector__empty">Choisissez un sample</div>}>
        {(x) => (
          <>
            <div class="cr-inspector__head">
              <span class="cr-inspector__title" title={x().path}>
                {x().name}
              </span>
              <IconButton
                icon={x().fav ? "star-fill" : "star"}
                label={x().fav ? "Retirer des favoris (⌘D)" : "Ajouter aux favoris (⌘D)"}
                active={x().fav}
                onClick={() => props.onToggleFav?.()}
              />
            </div>
            <Show when={(props.selectionCount ?? 1) > 1}>
              <div class="cr-inspector__note">
                {props.selectionCount} samples sélectionnés : tags et favori s'appliquent aux {props.selectionCount}.
              </div>
            </Show>

            <div class="cr-inspector__wave cr-wave">
              <Show when={!x().missing} fallback={<div class="cr-drawer__error">Fichier introuvable</div>}>
                <Waveform
                  peaks={props.peaks ?? x().peaks}
                  progress={props.playing ? props.progress : undefined}
                  themeKey={props.themeKey}
                  onSeek={props.onSeek}
                />
              </Show>
            </div>
            <div class="cr-inspector__transport">
              <IconButton
                icon={props.playing ? "stop" : "play"}
                label={props.playing ? "Stop (espace)" : "Lire (espace)"}
                active={props.playing}
                accent
                disabled={x().missing}
                onClick={() => props.onTogglePlay?.()}
              />
              <span class="cr-inspector__time cr-num">{time()}</span>
            </div>

            <dl class="cr-inspector__meta">
              <dt>BPM</dt>
              <dd class="cr-num">{x().bpm ?? "—"}</dd>
              <dt>Clé</dt>
              <dd>{x().key ?? "—"}</dd>
              <dt>Type</dt>
              <dd>{kind()}</dd>
              <dt>Durée</dt>
              <dd class="cr-num">{formatDuration(x().durationMs)} s</dd>
              <dt>Format</dt>
              <dd>
                {formatFormat(x())}
                <Show when={formatChannels(x().channels)}>{(c) => ` · ${c()}`}</Show>
              </dd>
            </dl>

            <section class="cr-inspector__section">
              <h3 class="cr-inspector__h">Tags</h3>
              <div class="cr-inspector__tags">
                <For each={x().tags}>
                  {(t) => (
                    <span class="cr-tag cr-tag--removable">
                      {t}
                      <button class="cr-tag__remove" aria-label={`Retirer le tag ${t}`} onClick={() => props.onRemoveTag?.(t)}>
                        <Icon name="close" />
                      </button>
                    </span>
                  )}
                </For>
                <button class="cr-tag" data-variant="add" onClick={() => props.onAddTag?.()}>
                  + tag
                </button>
              </div>
            </section>

            <section class="cr-inspector__section">
              <h3 class="cr-inspector__h">Dans</h3>
              <Show when={props.memberships?.length} fallback={<span class="cr-inspector__none">Aucune collection</span>}>
                <ul class="cr-inspector__list">
                  <For each={props.memberships}>
                    {(m) => (
                      <li>
                        <button class="cr-inspector__link" onClick={() => props.onJump?.(m.key)}>
                          <Icon name={m.key.startsWith("v:") ? "virtual" : "collection"} />
                          {m.name}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <section class="cr-inspector__section">
              <h3 class="cr-inspector__h">Fichier</h3>
              <span class="cr-inspector__path" title={x().path}>
                {x().path}
              </span>
              <div>
                <Button onClick={() => props.onReveal?.()}>Afficher dans le Finder</Button>
              </div>
            </section>
          </>
        )}
      </Show>
    </aside>
  );
}
