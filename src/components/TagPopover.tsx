// Popover de tags sur la sélection (touche T). Saisie = filtre ou création ;
// ↑↓ pour se déplacer, ⏎ ou espace pour cocher / décocher, Échap pour fermer.
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { Icon } from "./Icon";

export type TagState = "all" | "some" | "none";

export interface TagChoice {
  name: string;
  state: TagState;
}

export function TagPopover(props: {
  count: number;
  tags: TagChoice[];
  onToggle?: (name: string) => void;
  onClose?: () => void;
  autofocus?: boolean;
}) {
  let input!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);

  const q = () => query().trim().toLowerCase().replace(/^#/, "");
  const items = createMemo(() => {
    const list: (TagChoice & { create?: boolean })[] = props.tags.filter((t) => t.name.startsWith(q()));
    if (q() && !props.tags.some((t) => t.name === q())) list.push({ name: q(), state: "none", create: true });
    return list;
  });

  const toggle = (i: number) => {
    const it = items()[i];
    if (!it) return;
    props.onToggle?.(it.name);
    if (it.create) setQuery("");
  };

  onMount(() => props.autofocus !== false && input.focus({ preventScroll: true }));

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    const n = items().length;
    if (e.key === "ArrowDown" && n) setActive((active() + 1) % n);
    else if (e.key === "ArrowUp" && n) setActive((active() - 1 + n) % n);
    else if (e.key === "Enter") toggle(active());
    else if (e.key === " " && !query()) toggle(active());
    else if (e.key === "Escape") props.onClose?.();
    else return;
    e.preventDefault();
  }

  return (
    <div class="cr-popover" role="dialog" aria-label="Tags" onKeyDown={onKeyDown}>
      <div class="cr-popover__title">
        Tags · {props.count} sample{props.count > 1 ? "s" : ""}
      </div>
      <input
        ref={input}
        class="cr-popover__input"
        placeholder="Filtrer ou créer un tag"
        spellcheck={false}
        value={query()}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setActive(0);
        }}
      />
      <div class="cr-popover__list" role="listbox" aria-multiselectable="true">
        <For each={items()}>
          {(t, i) => (
            <div
              class="cr-popover__item"
              role="option"
              aria-selected={t.state === "all"}
              data-active={active() === i() || undefined}
              data-state={t.state}
              onMouseEnter={() => setActive(i())}
              onMouseDown={(e) => {
                e.preventDefault();
                toggle(i());
              }}
            >
              <span class="cr-popover__check">
                <Show when={t.state === "all"}>
                  <Icon name="check" />
                </Show>
                <Show when={t.state === "some"}>
                  <Icon name="minus" />
                </Show>
              </span>
              <span class="cr-popover__label">{t.create ? `Créer « ${t.name} »` : t.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
