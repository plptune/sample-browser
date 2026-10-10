// Choix exclusif court (2 à 3 options) : thème, densité.
import { For } from "solid-js";

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  label: string;
  onChange?: (v: T) => void;
}) {
  return (
    <div class="cr-seg" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(o) => (
          <button
            class="cr-seg__item"
            role="radio"
            aria-checked={props.value === o.value}
            data-active={props.value === o.value || undefined}
            onClick={() => props.onChange?.(o.value)}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  );
}
