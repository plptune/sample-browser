// Bas du panneau : tags du sample courant, son dossier (relatif à la source), son nom et sa waveform.
import { Show, createMemo, createSignal } from "solid-js";
import type { MidiNotes, Sample, SampleKind, Waveform as WaveformData } from "../api";
import { isMidi } from "../lib/format";
import { Autocomplete, type AcItem } from "./Autocomplete";
import { IconButton } from "./IconButton";
import { KindBadge } from "./KindBadge";
import { TagChips } from "./TagChips";
import { Waveform } from "./Waveform";

export function PreviewDrawer(props: {
  sample?: Sample | null;
  /** Pics du sample (demandés à part : les lignes de l'arbre ne les transportent pas). Défaut : `sample.peaks`. */
  peaks?: number[];
  /** Forme d'onde détaillée à la largeur affichée (Rust) ; sinon les 256 pics. */
  loadDetail?: (buckets: number) => Promise<WaveformData>;
  /** Notes du sample, s'il est MIDI : piano roll à la place de la forme d'onde. */
  loadNotes?: () => Promise<MidiNotes>;
  playing: boolean;
  progress: number;
  looping?: boolean;
  themeKey?: string;
  /** Dossier du sample, relatif à sa source (« Drums/Kicks/ »). */
  folder?: string;
  /** Chemin du sample relatif à sa source (infobulles) : jamais de chemin absolu à l'écran. */
  relPath?: string;
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
  /** Échap dans le champ des tags. */
  onTagsDone?: () => void;
}) {
  const s = () => props.sample;
  const midi = () => !!s() && isMidi(s()!);
  return (
    <section class="cr-drawer" aria-label="Preview" data-empty={!s() || undefined}>
      <Show when={s()}>
        {(x) => (
          <>
            <DrawerTags
              kind={x().kind}
              tags={x().tags}
              autoTags={x().autoTags}
              spliceTags={x().spliceTags}
              known={props.knownTags ?? []}
              onAdd={(t) => props.onAddTag?.(t)}
              onRemove={(t) => props.onRemoveTag?.(t)}
              onDone={props.onTagsDone}
            />
            <div class="cr-drawer__path" title={props.relPath}>
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
        <span class="cr-drawer__title" title={props.relPath}>
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
            accent
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
            loadDetail={midi() ? undefined : props.loadDetail}
            loadNotes={midi() ? props.loadNotes : undefined}
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

/** « Type: » et son badge (loop / one-shot), puis « Tags: », les tags du sample (× pour retirer) et un champ « Add… »
 *  (⏎ ajoute, suggestions des tags existants). Aussi dans la preview du mode grand, sans le type (déjà dans ses infos). */
export function DrawerTags(props: {
  kind: SampleKind;
  /** Montrer la catégorie « Type: » (défaut : oui). */
  showKind?: boolean;
  tags: string[];
  autoTags: string[];
  spliceTags?: string[];
  known: AcItem[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
  /** Échap : rend le clavier à la liste. */
  onDone?: () => void;
}) {
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
      props.onDone?.();
    }
  }
  return (
    <div class="cr-drawer__tags">
      <Show when={props.showKind ?? true}>
        <span class="cr-drawer__label">Type:</span>
        <KindBadge kind={props.kind} />
        <span class="cr-drawer__sep" />
      </Show>
      <span class="cr-drawer__label">Tags:</span>
      {/* Colonne : une seule ligne, les tags qui ne tiennent pas sont masqués (liste complète au survol). */}
      <span class="cr-drawer__chips" title={props.tags.join(", ") || undefined}>
        <TagChips tags={props.tags} autoTags={props.autoTags} spliceTags={props.spliceTags} onRemove={props.onRemove} />
      </span>
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
