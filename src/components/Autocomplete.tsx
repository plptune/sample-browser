import { For } from "solid-js";

export interface AcItem {
  label: string;
  count?: number;
}

export function Autocomplete(props: { items: AcItem[]; active: number; onPick: (i: number) => void }) {
  return (
    <div class="cr-ac" role="listbox">
      <For each={props.items}>
        {(it, i) => (
          <div
            class="cr-ac__item"
            role="option"
            aria-selected={i() === props.active}
            data-active={i() === props.active || undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(i());
            }}
          >
            <span class="cr-ac__label">{it.label}</span>
            <span class="cr-ac__count cr-num">{it.count}</span>
          </div>
        )}
      </For>
    </div>
  );
}
