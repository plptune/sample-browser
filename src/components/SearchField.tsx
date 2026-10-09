import { For, Show, createMemo, createSignal } from "solid-js";
import { app } from "../state/app";
import { Autocomplete, type AcItem } from "./Autocomplete";
import { Icon } from "./Icon";
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
    const items = lib.collections
      .filter((c) => c.name.toLowerCase().startsWith(q))
      .map((c) => ({ label: `in:${c.name.split(" ")[0]}` }));
    return { prefix: neg, items };
  }
  return null;
}

export function SearchField(props: { ref?: (el: HTMLInputElement) => void; forceAc?: boolean }) {
  let input!: HTMLInputElement;
  const [focused, setFocused] = createSignal(false);
  const [acIndex, setAcIndex] = createSignal(0);
  const [acDismissed, setAcDismissed] = createSignal(false);

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
      else input.blur();
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
    <div class="cr-panel__search">
      <div class="cr-search" data-focused={focused() || undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input.focus(); } }}>
        <Icon name="search" />
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
            placeholder={app.chips().length ? "" : "Rechercher"}
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
          <IconButton icon="close" label="Effacer la recherche" onClick={() => app.clearQuery()} />
        </Show>
      </div>
      <Show when={ac()}>{(s) => <Autocomplete items={s().items} active={acIndex()} onPick={pick} />}</Show>
    </div>
  );
}
