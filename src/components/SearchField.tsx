import { For, Show, createMemo, createSignal } from "solid-js";
import { app } from "../state/app";
import { Autocomplete, type AcItem } from "./Autocomplete";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { IconButton } from "./IconButton";
import { QueryChip } from "./QueryChip";

const KEY_SUGGESTIONS = ["Am", "C", "Cm", "D", "Dm", "Em", "F", "Fm", "F#m", "G", "Gm", "Bb", "Bm", "minor", "major"];

/** Filtres rapides de l'entonnoir : chacun pose (ou retire) une chip de recherche ; certains s'excluent. */
const QUICK_FILTERS: { label: string; chip: string; exclusive?: string[] }[][] = [
  [
    { label: "Favorites", chip: "is:fav" },
    { label: "In a collection", chip: "is:collection" },
  ],
  [
    { label: "Loops", chip: "type:loop", exclusive: ["type:oneshot"] },
    { label: "One-shots", chip: "type:oneshot", exclusive: ["type:loop"] },
  ],
  [
    { label: "Minor", chip: "key:minor", exclusive: ["key:major"] },
    { label: "Major", chip: "key:major", exclusive: ["key:minor"] },
  ],
];

/** Chip d'une collection : son nom complet entre guillemets. */
const collectionChip = (name: string) => `in:"${name}"`;

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
  let root: HTMLDivElement | undefined;
  // Menu des filtres actifs (entonnoir) : un clic sur un filtre le retire.
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  let filtersButton: HTMLElement | undefined;

  // Chips posables depuis l'entonnoir (filtres rapides et collections manuelles).
  const quickChips = () => [
    ...QUICK_FILTERS.flat().map((f) => f.chip),
    ...(app.library()?.collections ?? []).filter((c) => c.kind === "manual").map((c) => collectionChip(c.name)),
  ];
  // Dossiers aplatis : seulement dans l'arbre de la colonne (la liste du mode grand est toujours à plat).
  const flattened = () => (app.layout() === "full" ? [] : app.flattened());
  const activeFilters = () => app.chips().filter((c) => quickChips().includes(c)).length + flattened().length;
  const filterItems = (): MenuItem[] => {
    const check = (label: string, chip: string, exclusive: string[] = []): MenuItem => ({
      label,
      checked: app.hasChip(chip),
      keepOpen: true,
      action: () => app.toggleChip(chip, exclusive),
    });
    const collections = (app.library()?.collections ?? []).filter((c) => c.kind === "manual");
    const items: MenuItem[] = [{ type: "header", label: "Filters" }];
    QUICK_FILTERS.forEach((group, i) => {
      if (i > 0) items.push({ type: "separator" });
      items.push(...group.map((f) => check(f.label, f.chip, f.exclusive)));
      // Après « In a collection » : chaque collection manuelle.
      if (i === 0 && collections.length) {
        items.push({ type: "header", label: "Collections" }, ...collections.map((c) => check(c.name, collectionChip(c.name))));
      }
    });
    if (flattened().length) {
      items.push(
        { type: "separator" },
        { type: "header", label: "Flattened folders" },
        ...flattened().map((k) => ({ label: `Flattened: ${app.nodeName(k)}`, shortcut: "×", action: () => app.flatten(k, false) })),
        { label: "Clear flattened folders", action: () => app.clearFilters() },
      );
    }
    return items;
  };

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
      app.focusList("list");
      if (app.cursor() === null) app.move(0);
    }
  }

  return (
    <div class="cr-panel__search" ref={root}>
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
        {/* Filtres actifs (filtres rapides, dossiers aplatis) : l'entonnoir passe en couleur primaire. */}
        <IconButton
          icon="filter"
          label={activeFilters() ? `Filters (${activeFilters()} active)` : "Filters"}
          active={filtersOpen()}
          primary={activeFilters() > 0}
          ref={(el) => (filtersButton = el)}
          onClick={() => setFiltersOpen(!filtersOpen())}
        />
      </div>
      {/* En recherche, en colonne : Flatten (résultats à plat, en couleur primaire quand il est actif), puis Shuffle.
          La liste du mode grand est toujours à plat, triée par ses colonnes. */}
      <Show when={app.searching() && app.layout() !== "full"}>
        <div class="cr-search__options">
          <button
            class="cr-search__toggle"
            aria-pressed={app.flatResults()}
            data-active={app.flatResults() || undefined}
            title="Flat results: samples only, no folders"
            onClick={() => app.setFlatResults(!app.flatResults())}
          >
            Flatten
          </button>
          <Show when={app.flatResults()}>
            <IconButton icon="shuffle" label="Shuffle results" onClick={() => app.reshuffle()} />
          </Show>
        </div>
      </Show>
      <Show when={filtersOpen()}>
        <ContextMenu
          x={10_000}
          y={root?.offsetHeight ?? 0}
          items={filterItems()}
          anchor={() => filtersButton}
          onClose={() => setFiltersOpen(false)}
        />
      </Show>
      <Show when={ac()}>{(s) => <Autocomplete items={s().items} active={acIndex()} onPick={pick} />}</Show>
    </div>
  );
}
