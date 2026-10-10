// Bas du panneau : tags du sample courant, son dossier (relatif à la source), son nom et sa waveform.
import { For, Show, createMemo, createSignal } from "solid-js";
import type { Sample, Waveform as WaveformData } from "../api";
import { Autocomplete, type AcItem } from "./Autocomplete";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Waveform } from "./Waveform";

export function PreviewDrawer(props: {
  sample?: Sample | null;
  /** Pics du sample (demandés à part : les lignes de l'arbre ne les transportent pas). Défaut : `sample.peaks`. */
  peaks?: number[];
  /** Forme d'onde détaillée à la largeur affichée (Rust) ; sinon les 256 pics. */
  loadDetail?: (buckets: number) => Promise<WaveformData>;
  playing: boolean;
  progress: number;
  looping?: boolean;
  themeKey?: string;
  /** Dossier du sample, relatif à sa source (« Drums/Kicks/ »). */
  folder?: string;
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
  return (
    <section class="cr-drawer" aria-label="Preview" data-empty={!s() || undefined}>
      <Show when={s()}>
        {(x) => (
          <>
            <DrawerTags
              tags={x().tags}
              known={props.knownTags ?? []}
              onAdd={(t) => props.onAddTag?.(t)}
              onRemove={(t) => props.onRemoveTag?.(t)}
            />
            <div class="cr-drawer__path" title={x().path}>
              {props.folder ?? ""}
            </div>
          </>
        )}
      </Show>
      <div class="cr-drawer__head">
        <IconButton
          icon={props.playing ? "stop" : "play"}
          label={props.playing ? "Stop (Space)" : "Play (Space)"}
          active={props.playing}
          accent
          disabled={!s() || s()!.missing}
          onClick={() => props.onTogglePlay?.()}
        />
        <span class="cr-drawer__title" title={s()?.path}>
          {s() ? `${s()!.name}.${s()!.ext}` : "No sample"}
        </span>
        <IconButton
          icon="autoplay"
          label={props.autoPlay ? "Autoplay: on" : "Autoplay: off"}
          active={props.autoPlay}
          onClick={() => props.onAutoPlay?.(!props.autoPlay)}
        />
        {/* Favori : discret, gris, seulement ici (jamais dans les lignes de l'arbre). */}
        <Show when={s()}>
          <IconButton
            icon={s()!.fav ? "star-fill" : "star"}
            label={s()!.fav ? "Remove from favorites (⌘D)" : "Add to favorites (⌘D)"}
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
            loadDetail={props.loadDetail}
            detailKey={s()!.id}
            durationMs={s()!.durationMs}
            looping={props.looping}
          />
        </Show>
        <Show when={s()?.missing}>
          <div class="cr-drawer__error">File not found</div>
        </Show>
      </div>
    </section>
  );
}

/** « Tags: » puis les tags du sample (× pour retirer) et un champ « Add… » (⏎ ajoute, suggestions des tags existants). */
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
      <span class="cr-drawer__label">Tags:</span>
      <For each={props.tags}>
        {(t) => (
          <span class="cr-tag cr-tag--removable">
            {t}
            <button class="cr-tag__remove" aria-label={`Remove tag ${t}`} onClick={() => props.onRemove(t)}>
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
          placeholder="Add…"
          spellcheck={false}
          aria-label="Add a tag"
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
