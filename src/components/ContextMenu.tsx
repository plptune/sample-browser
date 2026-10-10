// Menu contextuel (clic droit). Clavier : ↑↓, ⏎, Échap. Se ferme au clic extérieur.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "./Icon";

export interface ActionItem {
  type?: "item";
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Option cochable (menu des options de recherche) : coche à droite. */
  checked?: boolean;
  action?: () => void;
}

export type MenuItem = ActionItem | { type: "separator" } | { type: "header"; label: string };

export function ContextMenu(props: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose?: () => void;
  /** Élément qui ouvre et ferme le menu lui-même (bouton) : un clic dessus ne compte pas comme « dehors ». */
  anchor?: () => Element | undefined;
}) {
  let el!: HTMLDivElement;
  const actionable = () => props.items.flatMap((it, i) => (it.type !== "separator" && it.type !== "header" && !it.disabled ? [i] : []));
  const [active, setActive] = createSignal<number | null>(null);
  const [pos, setPos] = createSignal({ x: props.x, y: props.y });

  const run = (i: number) => {
    const it = props.items[i];
    if (it.type === "separator" || it.type === "header" || it.disabled) return;
    props.onClose?.();
    it.action?.();
  };

  onMount(() => {
    // Reste dans le panneau : on décale vers la gauche / le haut si besoin.
    const host = el.offsetParent as HTMLElement | null;
    if (host) {
      const maxX = host.clientWidth - el.offsetWidth - 4;
      const maxY = host.clientHeight - el.offsetHeight - 4;
      setPos({ x: Math.max(4, Math.min(props.x, maxX)), y: Math.max(4, Math.min(props.y, maxY)) });
    }
    el.focus({ preventScroll: true });
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!el.contains(t) && !props.anchor?.()?.contains(t)) props.onClose?.();
    };
    window.addEventListener("mousedown", away, true);
    onCleanup(() => window.removeEventListener("mousedown", away, true));
  });

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    const list = actionable();
    const at = active() === null ? -1 : list.indexOf(active()!);
    if (e.key === "ArrowDown") setActive(list[(at + 1) % list.length]);
    else if (e.key === "ArrowUp") setActive(list[(at - 1 + list.length) % list.length]);
    else if (e.key === "Enter" && active() !== null) run(active()!);
    else if (e.key === "Escape") props.onClose?.();
    else return;
    e.preventDefault();
  }

  return (
    <div
      ref={el}
      class="cr-menu"
      role="menu"
      tabindex="-1"
      style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <For each={props.items}>
        {(it, i) => (
          <Show
            when={it.type !== "separator"}
            fallback={<div class="cr-menu__sep" role="separator" />}
          >
            <Show
              when={it.type !== "header"}
              fallback={<div class="cr-menu__header">{(it as { label: string }).label}</div>}
            >
              {(() => {
                const item = it as ActionItem;
                return (
                  <div
                    class="cr-menu__item"
                    role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={item.checked === undefined ? undefined : item.checked}
                    aria-disabled={item.disabled || undefined}
                    data-active={active() === i() || undefined}
                    data-danger={item.danger || undefined}
                    data-disabled={item.disabled || undefined}
                    onMouseEnter={() => !item.disabled && setActive(i())}
                    onMouseLeave={() => setActive(null)}
                    onMouseUp={() => run(i())}
                  >
                    <span class="cr-menu__label">{item.label}</span>
                    <Show when={item.shortcut}>
                      <span class="cr-menu__shortcut">{item.shortcut}</span>
                    </Show>
                    <Show when={item.checked}>
                      <Icon name="check" class="cr-menu__check" />
                    </Show>
                  </div>
                );
              })()}
            </Show>
          </Show>
        )}
      </For>
    </div>
  );
}
