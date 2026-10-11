// Mode grand : la liste à plat des samples de la portée, en colonnes triables (nom, BPM, tonalité, durée, format,
// tags). Un clic sur un en-tête trie par cette colonne ; un second clic inverse le sens.
import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, createEffect, on } from "solid-js";
import type { SampleRow, SortColumn } from "../api";
import { formatDuration, formatFormat, isMidi, relativePath } from "../lib/format";
import { app } from "../state/app";
import { OVERSCAN, PAD, ROW_H, sampleRowHandlers } from "./Browser";
import { Chevron, Icon } from "./Icon";

const COLUMNS: { id: SortColumn; label: string; cls: string }[] = [
  { id: "name", label: "Name", cls: "cr-col-name" },
  { id: "bpm", label: "BPM", cls: "cr-col-bpm" },
  { id: "key", label: "Key", cls: "cr-col-key" },
  { id: "duration", label: "Length", cls: "cr-col-dur" },
  { id: "format", label: "Format", cls: "cr-col-fmt" },
  { id: "tags", label: "Tags", cls: "cr-col-tags" },
];

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
  return (
    <div class="cr-table" role="grid" aria-label="Samples" aria-rowcount={m.shownTotal()} aria-multiselectable="true">
      <div class="cr-table__head" role="row">
        <For each={COLUMNS}>
          {(c) => (
            <button
              class={`cr-table__th ${c.cls}`}
              role="columnheader"
              aria-sort={sorted(c.id) ? (app.listSort().desc ? "descending" : "ascending") : "none"}
              data-active={sorted(c.id) || undefined}
              title={`Sort by ${c.label.toLowerCase()}`}
              onClick={() => app.sortBy(c.id)}
            >
              <span class="cr-table__label">{c.label}</span>
              <Show when={sorted(c.id)}>
                <span class="cr-table__dir" data-desc={app.listSort().desc || undefined}>
                  <Chevron />
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
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
                <ResultSlot index={item.index} />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

/** Une case de la liste : le même composant sert quand la ligne change (défilement, tri), rien n'est recréé. */
function ResultSlot(props: { index: number }) {
  const row = () => {
    const r = app.results.rowAt(props.index);
    return r?.type === "sample" ? r : undefined;
  };
  return (
    <Show when={row()} fallback={<div class="cr-node cr-table__row" aria-busy="true" />}>
      {(r) => <ResultRow row={r()} />}
    </Show>
  );
}

function ResultRow(props: { row: SampleRow }) {
  const s = () => props.row.sample;
  const h = sampleRowHandlers(() => props.row.key, s);
  const selected = () => app.results.selection().includes(props.row.key);
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
      <span class="cr-col-name" role="gridcell">
        <span class="cr-node__icon" data-icon={isMidi(s()) ? "midi" : "sample"}>
          <Icon name={isMidi(s()) ? "midi" : "sample"} />
        </span>
        <Show when={s().missing}>
          <span class="cr-node__warn">!</span>
        </Show>
        <span class="cr-node__label">{`${s().name}.${s().ext}`}</span>
      </span>
      <span class="cr-col-bpm cr-node__meta" role="gridcell">
        {s().bpm ?? ""}
      </span>
      <span class="cr-col-key cr-node__meta" role="gridcell">
        {s().key ?? ""}
      </span>
      <span class="cr-col-dur cr-node__meta" role="gridcell">
        {formatDuration(s().durationMs)}
      </span>
      <span class="cr-col-fmt cr-node__meta" role="gridcell">
        {formatFormat(s())}
      </span>
      <span class="cr-col-tags" role="gridcell" title={[s().kind, ...s().tags].join(", ")}>
        <span class="cr-col-tags__kind">{s().kind}</span>
        <For each={s().tags}>
          {(t) => (
            <span class="cr-col-tags__tag" data-auto={s().autoTags.includes(t) || undefined}>
              {t}
            </span>
          )}
        </For>
      </span>
    </div>
  );
}
