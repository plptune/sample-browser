import { Show, onMount } from "solid-js";
import { Chevron } from "./Icon";

const fmt = new Intl.NumberFormat("fr-FR");

export function SidebarItem(props: {
  label: string;
  count?: number;
  depth?: number;
  mark?: "manual" | "smart" | "fav";
  expandable?: boolean;
  open?: boolean;
  selected?: boolean;
  offline?: boolean;
  dropTarget?: boolean;
  renaming?: boolean;
  onClick?: () => void;
  onToggle?: () => void;
  onRename?: (name: string) => void;
  onDblClick?: () => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
}) {
  return (
    <div
      class="cr-item"
      role="treeitem"
      aria-selected={!!props.selected}
      aria-expanded={props.expandable ? !!props.open : undefined}
      style={{ "--depth": props.depth ?? 0 }}
      data-selected={props.selected || undefined}
      data-offline={props.offline || undefined}
      data-drop-target={props.dropTarget || undefined}
      onClick={() => props.onClick?.()}
      onDblClick={() => props.onDblClick?.()}
      onDragOver={(e) => props.onDragOver?.(e)}
      onDragLeave={() => props.onDragLeave?.()}
      onDrop={(e) => props.onDrop?.(e)}
    >
      <Show when={props.expandable} fallback={<span class="cr-item__spacer" />}>
        <span
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle?.();
          }}
        >
          <Chevron open={props.open} />
        </span>
      </Show>
      <Show when={props.mark}>
        <span class="cr-item__mark" data-kind={props.mark} />
      </Show>
      <Show when={props.renaming} fallback={<span class="cr-item__label">{props.label}</span>}>
        <RenameInput value={props.label} onDone={(v) => props.onRename?.(v)} />
      </Show>
      <Show when={props.offline}>
        <span class="cr-item__badge">déconnecté</span>
      </Show>
      <Show when={props.count !== undefined && !props.offline}>
        <span class="cr-item__count cr-num">{fmt.format(props.count!)}</span>
      </Show>
    </div>
  );
}

function RenameInput(props: { value: string; onDone: (v: string) => void }) {
  let input!: HTMLInputElement;
  let done = false;
  const finish = (v: string) => {
    if (done) return;
    done = true;
    props.onDone(v);
  };
  onMount(() => {
    input.focus();
    input.select();
  });
  return (
    <input
      ref={input}
      class="cr-item__input"
      value={props.value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(input.value);
        if (e.key === "Escape") finish(props.value);
      }}
      onBlur={() => finish(input.value)}
    />
  );
}
