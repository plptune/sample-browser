// Choix exclusif court (2 à 3 options) : thème, densité, mode d'affichage (icônes seules).
import { For, Show } from "solid-js";
import { Icon, type IconName } from "./Icon";

export function Segmented<T extends string>(props: {
  value: T;
  /** Avec `icon`, le libellé devient l'infobulle et le nom accessible. */
  options: { value: T; label: string; icon?: IconName }[];
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
            data-icon={o.icon ? "" : undefined}
            title={o.icon ? o.label : undefined}
            aria-label={o.icon ? o.label : undefined}
            onClick={() => props.onChange?.(o.value)}
          >
            <Show when={o.icon} fallback={o.label}>
              {(i) => <Icon name={i()} />}
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
