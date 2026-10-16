// Mode grand : la liste à plat des samples de la portée, en colonnes triables (nom, type, BPM, tonalité, durée,
// format, tags). Un clic sur un en-tête trie par cette colonne ; un second clic inverse le sens. Clic droit sur
// l'en-tête : les colonnes à afficher ; tirer un en-tête : changer l'ordre.
import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, createEffect, createSignal, on, type JSX } from "solid-js";
import type { SampleRow, SortColumn } from "../api";
import { formatDuration, formatFormat, isMidi, relativePath } from "../lib/format";
import { app } from "../state/app";
import { OVERSCAN, PAD, ROW_H, sampleRowHandlers } from "./Browser";
import { Chevron, Icon } from "./Icon";
import { FavStar } from "./TreeRow";
import { KindBadge } from "./KindBadge";
import { ContextMenu, type MenuItem } from "./ContextMenu";

/** Les colonnes : libellé, classe, largeur (tokens `--cr-tcol-*`). L'ordre et l'affichage viennent de `app.listColumns`. */
export const COLUMNS: Record<SortColumn, { label: string; cls: string; width: string }> = {
  name: { label: "Name", cls: "cr-col-name", width: "minmax(var(--cr-tcol-name-min), 1fr)" },
  kind: { label: "Type", cls: "cr-col-kind", width: "var(--cr-tcol-kind)" },
  bpm: { label: "BPM", cls: "cr-col-bpm", width: "var(--cr-tcol-bpm)" },
  key: { label: "Key", cls: "cr-col-key", width: "var(--cr-tcol-key)" },
  duration: { label: "Length", cls: "cr-col-dur", width: "var(--cr-tcol-dur)" },
  format: { label: "Format", cls: "cr-col-fmt", width: "var(--cr-tcol-fmt)" },
  tags: { label: "Tags", cls: "cr-col-tags", width: "var(--cr-tcol-tags)" },
};

/** En-tête tiré au-delà de ce seuil (px) : on change l'ordre, sinon c'est un clic (tri). */
const DRAG_START = 4;

export function ResultsTable() {
  const m = app.results;
  let scroller!: HTMLDivElement;
  const virtualizer = createVirtualizer({
    get count() {
      return m.shownTotal();
    },
    getScrollElement: () => scroller,
    estimateSize: () => ROW_H[app.fontSize()],
    overscan: OVERSCAN,
    paddingEnd: PAD,
    scrollPaddingEnd: PAD,
  });
  createEffect(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length) m.setViewRange(items[0].index, items[items.length - 1].index + 1);
  });
  // Autre portée, autre recherche, autre tri : la liste repart du haut ; le curseur reste visible.
  createEffect(on(m.scrollReset, () => virtualizer.scrollToOffset(0), { defer: true }));
  createEffect(
    on(m.cursor, (key) => {
      const i = m.indexOf(key);
      if (i >= 0) virtualizer.scrollToIndex(i, { align: "auto" });
    }),
  );
  createEffect(on(app.fontSize, () => virtualizer.measure(), { defer: true }));

  const sorted = (c: SortColumn) => app.listSort().column === c;
  const shown = () => app.listColumns().filter((c) => c.visible).map((c) => c.id);
  const template = () => shown().map((id) => COLUMNS[id].width).join(" ");

  // Clic droit sur l'en-tête : les colonnes à afficher (Name toujours), puis l'ordre d'origine.
  let table!: HTMLDivElement;
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
  const menuItems = (): MenuItem[] => [
    { type: "header", label: "Columns" },
    ...app.listColumns().map((c) => ({
      label: COLUMNS[c.id].label,
      checked: c.visible,
      disabled: c.id === "name",
      keepOpen: true,
      action: () => app.toggleColumn(c.id),
    })),
    { type: "separator" },
    { label: "Reset columns", action: () => app.resetColumns() },
  ];

  // Ordre des colonnes : un en-tête tiré au pointeur (le glisser HTML n'arrive pas dans la fenêtre Tauri).
  const [drag, setDrag] = createSignal<{ id: SortColumn; dx: number; to: number } | null>(null);
  let head!: HTMLDivElement;
  let press: { id: SortColumn; x: number; moved: boolean } | null = null;
  /** Place d'insertion (parmi les colonnes affichées) pour un pointeur en `x` : avant le premier en-tête dont le
   *  milieu est à droite. */
  const insertAt = (x: number) => {
    const cells = [...head.querySelectorAll<HTMLElement>("[data-col]")];
    const i = cells.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return i < 0 ? cells.length : i;
  };
  const onHeadDown = (e: PointerEvent, id: SortColumn) => {
    if (e.button !== 0) return;
    press = { id, x: e.clientX, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHeadMove = (e: PointerEvent) => {
    if (!press) return;
    const dx = e.clientX - press.x;
    if (!press.moved && Math.abs(dx) < DRAG_START) return;
    press.moved = true;
    setDrag({ id: press.id, dx, to: insertAt(e.clientX) });
  };
  const onHeadUp = (id: SortColumn) => {
    const d = drag();
    const moved = press?.moved;
    press = null;
    setDrag(null);
    if (!moved) return app.sortBy(id);
    if (d) app.moveColumn(d.id, d.to);
  };
  /** Trait d'insertion : à gauche de l'en-tête visé, ou à droite du dernier. */
  const marker = (id: SortColumn): "before" | "after" | undefined => {
    const d = drag();
    if (!d || d.id === id) return undefined;
    const i = shown().indexOf(id);
    if (d.to === i) return "before";
    if (d.to === shown().length && i === shown().length - 1) return "after";
    return undefined;
  };

  return (
    <div
      ref={table}
      class="cr-table"
      role="grid"
      aria-label="Samples"
      aria-rowcount={m.shownTotal()}
      aria-multiselectable="true"
      style={{ "--cr-table-cols": template() }}
    >
      <div
        ref={head}
        class="cr-table__head"
        role="row"
        onContextMenu={(e) => {
          e.preventDefault();
          const r = table.getBoundingClientRect();
          setMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
      >
        <For each={shown()}>
          {(id) => (
            <button
              class={`cr-table__th ${COLUMNS[id].cls}`}
              role="columnheader"
              data-col={id}
              aria-sort={sorted(id) ? (app.listSort().desc ? "descending" : "ascending") : "none"}
              data-active={sorted(id) || undefined}
              data-dragging={drag()?.id === id || undefined}
              data-insert={marker(id)}
              style={drag()?.id === id ? { transform: `translateX(${drag()!.dx}px)` } : undefined}
              title={`Sort by ${COLUMNS[id].label.toLowerCase()} · drag to reorder`}
              onPointerDown={(e) => onHeadDown(e, id)}
              onPointerMove={onHeadMove}
              onPointerUp={() => onHeadUp(id)}
              onPointerCancel={() => {
                press = null;
                setDrag(null);
              }}
            >
              <span class="cr-table__label">{COLUMNS[id].label}</span>
              <Show when={sorted(id)}>
                <span class="cr-table__dir" data-desc={app.listSort().desc || undefined}>
                  <Chevron />
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <Show when={menu()}>
        {(p) => <ContextMenu x={p().x} y={p().y} items={menuItems()} onClose={() => setMenu(null)} />}
      </Show>
      <div
        ref={(el) => {
          scroller = el;
          app.registerZone("list", el);
        }}
        class="cr-tree cr-table__body"
        data-virtual
        data-focused={(app.listFocused() && app.zone() === "list") || undefined}
        tabindex="0"
        role="rowgroup"
        onFocus={() => {
          app.setListFocused(true);
          app.setZone("list");
        }}
        onBlur={() => app.setListFocused(false)}
      >
        <div class="cr-tree__space" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          <For each={virtualizer.getVirtualItems()}>
            {(item) => (
              <div class="cr-tree__row" data-key={m.rowAt(item.index)?.key} style={{ transform: `translateY(${item.start}px)` }}>
                <ResultSlot index={item.index} columns={shown()} />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

/** Une case de la liste : le même composant sert quand la ligne change (défilement, tri), rien n'est recréé. */
function ResultSlot(props: { index: number; columns: SortColumn[] }) {
  const row = () => {
    const r = app.results.rowAt(props.index);
    return r?.type === "sample" ? r : undefined;
  };
  return (
    <Show when={row()} fallback={<div class="cr-node cr-table__row" aria-busy="true" />}>
      {(r) => <ResultRow row={r()} columns={props.columns} />}
    </Show>
  );
}

function ResultRow(props: { row: SampleRow; columns: SortColumn[] }) {
  const s = () => props.row.sample;
  const h = sampleRowHandlers(() => props.row.key, s, app.results);
  const selected = () => app.results.selection().includes(props.row.key);
  /** Une cellule, selon sa colonne. */
  const cell = (id: SortColumn): JSX.Element => {
    switch (id) {
      case "name":
        return (
          <span class="cr-col-name" role="gridcell">
            <span class="cr-node__icon" data-icon={isMidi(s()) ? "midi" : "sample"}>
              <Icon name={isMidi(s()) ? "midi" : "sample"} />
            </span>
            <Show when={s().fav}>
              <FavStar />
            </Show>
            <Show when={s().missing}>
              <span class="cr-node__warn">!</span>
            </Show>
            <span class="cr-node__label">{`${s().name}.${s().ext}`}</span>
          </span>
        );
      case "kind":
        return (
          <span class="cr-col-kind" role="gridcell">
            <KindBadge kind={s().kind} />
          </span>
        );
      case "bpm":
        return (
          <span class="cr-col-bpm cr-node__meta" role="gridcell">
            {s().bpm ?? ""}
          </span>
        );
      case "key":
        return (
          <span class="cr-col-key cr-node__meta" role="gridcell">
            {s().key ?? ""}
          </span>
        );
      case "duration":
        return (
          <span class="cr-col-dur cr-node__meta" role="gridcell">
            {formatDuration(s().durationMs)}
          </span>
        );
      case "format":
        return (
          <span class="cr-col-fmt cr-node__meta" role="gridcell">
            {formatFormat(s())}
          </span>
        );
      case "tags":
        return (
          <span class="cr-col-tags" role="gridcell" title={s().tags.join(", ")}>
            <For each={s().tags}>
              {(t) => (
                <span class="cr-col-tags__tag" data-auto={s().autoTags.includes(t) || s().spliceTags.includes(t) || undefined}>
                  {t}
                </span>
              )}
            </For>
          </span>
        );
    }
  };
  return (
    <div
      class="cr-node cr-table__row"
      role="row"
      aria-selected={selected()}
      data-kind="sample"
      data-selected={selected() || undefined}
      data-playing={app.playingId() === s().id || undefined}
      data-missing={s().missing || undefined}
      data-hidden={s().hidden || undefined}
      data-dragging={app.draggingKey() === props.row.key || undefined}
      draggable={!s().missing}
      title={(s().missing ? "Missing: " : "") + relativePath(s().path, app.sources())}
      onMouseDown={h.onMouseDown}
      onDblClick={h.onDblClick}
      onContextMenu={(e) => {
        e.preventDefault();
        h.onContextMenu(e);
      }}
      onDragStart={h.onDragStart}
      onDragEnd={h.onDragEnd}
    >
      <For each={props.columns}>{(id) => cell(id)}</For>
    </div>
  );
}

