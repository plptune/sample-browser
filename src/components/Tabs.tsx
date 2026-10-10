// Onglets de la barre titre. Survoler un onglet en glissant des samples l'ouvre (comme les dossiers du Finder).
import { For, Show, onCleanup } from "solid-js";
import { Icon, type IconName } from "./Icon";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  shortcut?: string;
  icon?: IconName;
}

export function Tabs<T extends string>(props: {
  value: T;
  items: TabItem<T>[];
  onChange?: (v: T) => void;
  /** Ouvre l'onglet après un court survol pendant un glisser-déposer. */
  springLoaded?: boolean;
  /** Colonne étroite : l'icône seule (le nom reste dans l'infobulle et pour les lecteurs d'écran). */
  iconOnly?: boolean;
}) {
  let timer = 0;
  onCleanup(() => clearTimeout(timer));
  return (
    <div class="cr-tabs" role="tablist">
      <For each={props.items}>
        {(it) => (
          <button
            class="cr-tab"
            role="tab"
            aria-selected={props.value === it.value}
            data-active={props.value === it.value || undefined}
            data-tab={it.value}
            data-icon-only={(props.iconOnly && it.icon) || undefined}
            title={it.shortcut ? `${it.label} (${it.shortcut})` : it.label}
            aria-label={it.label}
            onClick={() => props.onChange?.(it.value)}
            onDragEnter={() => {
              if (!props.springLoaded || props.value === it.value) return;
              clearTimeout(timer);
              timer = window.setTimeout(() => props.onChange?.(it.value), 500);
            }}
            onDragLeave={() => clearTimeout(timer)}
            onDragOver={(e) => props.springLoaded && e.preventDefault()}
          >
            <Show when={props.iconOnly && it.icon} fallback={it.label}>
              <Icon name={it.icon!} />
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
