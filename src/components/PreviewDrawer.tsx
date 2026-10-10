// Bas du panneau : le sample courant, sa waveform et ses tags.
import { For, Show, createMemo, createSignal } from "solid-js";
import type { Sample } from "../api";
import { formatDuration } from "../lib/format";
import { Autocomplete, type AcItem } from "./Autocomplete";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Waveform } from "./Waveform";

export function PreviewDrawer(props: {
  sample?: Sample | null;
  /** Pics du sample (demandés à part : les lignes de l'arbre ne les transportent pas). Défaut : `sample.peaks`. */
  peaks?: number[];
  playing: boolean;
  progress: number;
  themeKey?: string;
  /** Lecture auto : ↑/↓ et clic lisent le sample dès qu'il est sélectionné. */
  autoPlay?: boolean;
  /** Tags existants de la bibliothèque, proposés pendant la frappe. */
  knownTags?: AcItem[];
  onTogglePlay?: () => void;
  onToggleFav?: () => void;
  onAutoPlay?: (v: boolean) => void;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  /** Clic dans la waveform : position 0..1. */
  onSeek?: (fraction: number) => void;
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
        <IconButton
          icon="autoplay"
          label={props.autoPlay ? "Lecture auto : activée" : "Lecture auto : désactivée"}
          active={props.autoPlay}
          onClick={() => props.onAutoPlay?.(!props.autoPlay)}
        />
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
          <Waveform
            peaks={props.peaks ?? s()!.peaks}
            progress={props.playing ? props.progress : undefined}
            themeKey={props.themeKey}
            onSeek={props.onSeek}
          />
        </Show>
        <Show when={s()?.missing}>
          <div class="cr-drawer__error">Fichier introuvable</div>
        </Show>
      </div>
      <Show when={s()}>
        {(x) => (
          <DrawerTags
            tags={x().tags}
            known={props.knownTags ?? []}
            onAdd={(t) => props.onAddTag?.(t)}
            onRemove={(t) => props.onRemoveTag?.(t)}
          />
        )}
      </Show>
    </section>
  );
}

/** « Tags : » puis les tags du sample (× pour retirer) et un champ « Ajouter… » (⏎ ajoute, suggestions des tags existants). */
function DrawerTags(props: { tags: string[]; known: AcItem[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  let input!: HTMLInputElement;
  const [draft, setDraft] = createSignal("");
  const [focused, setFocused] = createSignal(false);
  const [acIndex, setAcIndex] = createSignal(-1);
  const suggestions = createMemo(() => {
    const q = draft().trim().toLowerCase();
    if (!focused() || !q) return [];
    return props.known.filter((t) => t.label.startsWith(q) && !props.tags.includes(t.label)).slice(0, 6);
  });
  const add = (t: string) => {
    const name = t.trim().toLowerCase();
    if (name) props.onAdd(name);
    setDraft("");
    setAcIndex(-1);
  };
  function onKeyDown(e: KeyboardEvent) {
    const items = suggestions();
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setAcIndex((acIndex() + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setAcIndex(acIndex() <= 0 ? items.length - 1 : acIndex() - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      add(acIndex() >= 0 && items[acIndex()] ? items[acIndex()].label : draft());
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDraft("");
      input.blur();
      document.querySelector<HTMLElement>(".cr-tree")?.focus();
    }
  }
  return (
    <div class="cr-drawer__tags">
      <span class="cr-drawer__label">Tags :</span>
      <For each={props.tags}>
        {(t) => (
          <span class="cr-tag cr-tag--removable">
            {t}
            <button class="cr-tag__remove" aria-label={`Retirer le tag ${t}`} onClick={() => props.onRemove(t)}>
              <Icon name="close" />
            </button>
          </span>
        )}
      </For>
      <span class="cr-drawer__add">
        <input
          ref={input}
          class="cr-drawer__input"
          value={draft()}
          placeholder="Ajouter…"
          spellcheck={false}
          aria-label="Ajouter un tag"
          onInput={(e) => {
            setDraft(e.currentTarget.value);
            setAcIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <Show when={suggestions().length}>
          <div class="cr-drawer__ac">
            <Autocomplete items={suggestions()} active={acIndex()} onPick={(i) => add(suggestions()[i].label)} />
          </div>
        </Show>
      </span>
    </div>
  );
}
