import { For, Show, createMemo, createSignal } from "solid-js";
import { app } from "../state/app";
import { Autocomplete, type AcItem } from "./Autocomplete";
import { ContextMenu } from "./ContextMenu";
import { IconButton } from "./IconButton";
import { QueryChip } from "./QueryChip";

const KEY_SUGGESTIONS = ["Am", "C", "Cm", "D", "Dm", "Em", "F", "Fm", "F#m", "G", "Gm", "Bb", "Bm"];

/** Valeurs proposées selon le token en cours de frappe. */
function suggestionsFor(token: string): { prefix: string; items: AcItem[] } | null {
  const neg = token.startsWith("-") ? "-" : "";
  const t = token.slice(neg.length);
  const lib = app.library();
  if (!lib) return null;
  if (t.startsWith("#")) {
    const q = t.slice(1).toLowerCase();
    const used = app.chips();
    const items = lib.tags
      .filter((x) => x.name.startsWith(q) && !used.includes(`#${x.name}`) && !used.includes(`-#${x.name}`))
      .map((x) => ({ label: `#${x.name}`, count: x.count }));
    return { prefix: neg, items };
  }
  if (t.toLowerCase().startsWith("key:")) {
    const q = t.slice(4).toLowerCase();
    return { prefix: neg, items: KEY_SUGGESTIONS.filter((k) => k.toLowerCase().startsWith(q)).map((k) => ({ label: `key:${k}` })) };
  }
  if (t.toLowerCase().startsWith("in:")) {
    const q = t.slice(3).toLowerCase();
    const names = [...lib.collections.map((c) => c.name), ...lib.virtualFolders.map((f) => f.name)];
    const items = names.filter((n) => n.toLowerCase().startsWith(q)).map((n) => ({ label: `in:${n.split(" ")[0]}` }));
    return { prefix: neg, items };
  }
  return null;
}

export function SearchField(props: { ref?: (el: HTMLInputElement) => void; forceAc?: boolean }) {
  let input!: HTMLInputElement;
  const [focused, setFocused] = createSignal(false);
  const [acIndex, setAcIndex] = createSignal(0);
  const [acDismissed, setAcDismissed] = createSignal(false);
  // Menu des options de recherche (à droite du champ) ; le bouton l'ouvre et le ferme.
  const [optsOpen, setOptsOpen] = createSignal(false);
  let opts: HTMLDivElement | undefined;
  let optsButton: HTMLElement | undefined;
  // Menu des filtres actifs (entonnoir) : un clic sur un filtre le retire.
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  let filtersButton: HTMLElement | undefined;

  const current = () => app.draft().split(/\s+/).pop() ?? "";
  const ac = createMemo(() => {
    if ((!focused() && !props.forceAc) || acDismissed()) return null;
    const s = suggestionsFor(current());
    return s && s.items.length ? { ...s, items: s.items.slice(0, 8) } : null;
  });

  function pick(i: number) {
    const s = ac();
    if (!s) return;
    const parts = app.draft().split(/\s+/);
    parts[parts.length - 1] = s.prefix + s.items[i].label;
    app.setQueryDraft(parts.join(" ") + " ");
    setAcIndex(0);
  }

  function onKeyDown(e: KeyboardEvent) {
    const s = ac();
    if (s) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = s.items.length;
        setAcIndex((acIndex() + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(acIndex());
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAcDismissed(true);
        return;
      }
    }
    if (e.key === "Backspace" && input.selectionStart === 0 && input.selectionEnd === 0 && app.chips().length) {
      e.preventDefault();
      app.removeChip(app.chips().length - 1);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (app.queryLine()) app.clearQuery();
      else {
        input.blur();
        // Venu du DAW par son raccourci : Échap sur la recherche vide lui rend la main (sans effet sinon).
        void app.returnToDaw();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      const list = document.querySelector<HTMLElement>(".cr-tree");
      list?.focus();
      if (app.cursor() === null) app.move(0);
    }
  }

  return (
    <div class="cr-panel__search" ref={opts}>
      <div class="cr-search" data-focused={focused() || undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.focus(); } }}>
        <div class="cr-search__chips">
          <For each={app.chips()}>{(raw, i) => <QueryChip raw={raw} onClick={() => { app.editChip(i()); input.focus(); }} />}</For>
          <input
            ref={(el) => {
              input = el;
              props.ref?.(el);
            }}
            class="cr-search__input"
            type="text"
            spellcheck={false}
            autocomplete="off"
            placeholder={app.chips().length ? "" : "Search"}
            value={app.draft()}
            onInput={(e) => {
              setAcDismissed(false);
              setAcIndex(0);
              app.setQueryDraft(e.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </div>
        <Show when={app.queryLine()}>
          <IconButton icon="close" label="Clear search" onClick={() => app.clearQuery()} />
        </Show>
        {/* Filtres actifs (dossiers aplatis) : l'entonnoir passe en couleur primaire. */}
        <IconButton
          icon="filter"
          label={app.flattened().length ? `Filters (${app.flattened().length} active)` : "Filters"}
          active={filtersOpen()}
          primary={app.flattened().length > 0}
          ref={(el) => (filtersButton = el)}
          onClick={() => setFiltersOpen(!filtersOpen())}
        />
        <IconButton
          icon="gear"
          label="Search options"
          active={optsOpen() || app.flatResults()}
          ref={(el) => (optsButton = el)}
          onClick={() => setOptsOpen(!optsOpen())}
        />
      </div>
      <Show when={filtersOpen()}>
        <ContextMenu
          x={10_000}
          y={opts?.offsetHeight ?? 0}
          items={[
            { type: "header", label: "Active filters" },
            ...(app.flattened().length
              ? [
                  ...app.flattened().map((k) => ({ label: `Flattened: ${app.nodeName(k)}`, shortcut: "×", action: () => app.flatten(k, false) })),
                  { type: "separator" as const },
                  { label: "Clear filters", action: () => app.clearFilters() },
                ]
              : [{ label: "No active filters", disabled: true }]),
          ]}
          anchor={() => filtersButton}
          onClose={() => setFiltersOpen(false)}
        />
      </Show>
      <Show when={optsOpen()}>
        <ContextMenu
          x={10_000}
          y={opts?.offsetHeight ?? 0}
          items={[
            { type: "header", label: "Search options" },
            { label: "Flat results", checked: app.flatResults(), action: () => app.setFlatResults(!app.flatResults()) },
          ]}
          anchor={() => optsButton}
          onClose={() => setOptsOpen(false)}
        />
      </Show>
      <Show when={ac()}>{(s) => <Autocomplete items={s().items} active={acIndex()} onPick={pick} />}</Show>
    </div>
  );
}
