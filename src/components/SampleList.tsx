import { For, createEffect } from "solid-js";
import type { SortKey } from "../api";
import { app } from "../state/app";
import { SampleRow } from "./SampleRow";

function Header(props: { k: SortKey; label: string; class: string }) {
  return (
    <span class={props.class} data-sorted={app.sort() === props.k || undefined} onClick={() => { app.setSort(props.k); app.refresh(); }}>
      {props.label}
    </span>
  );
}

export function SampleList() {
  return (
    <div
      class="cr-list"
      data-focused={app.listFocused() || undefined}
      tabindex="0"
      role="listbox"
      aria-multiselectable="true"
      aria-label="Samples"
      onFocus={() => app.setListFocused(true)}
      onBlur={() => app.setListFocused(false)}
    >
      <div class="cr-list__header">
        <span class="cr-col-state" />
        <span class="cr-col-name" data-sorted={app.sort() === "name" || undefined} onClick={() => { app.setSort("name"); app.refresh(); }}>
          Nom
        </span>
        <Header k="bpm" label="BPM" class="cr-col-bpm" />
        <Header k="key" label="Clé" class="cr-col-key" />
      </div>
      <div class="cr-list__body">
        <For each={app.visible()}>
          {(s) => {
            let el!: HTMLDivElement;
            createEffect(() => {
              if (app.cursor() === s.id) el?.scrollIntoView({ block: "nearest" });
            });
            return (
              <SampleRow
                ref={(r) => (el = r)}
                sample={s}
                selected={app.selection().includes(s.id)}
                playing={app.playingId() === s.id}
                progress={app.progress()}
                wave={app.density() === "wave"}
                dragging={app.draggingId() === s.id}
                themeKey={app.theme()}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  app.select(s.id, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
                }}
                onDblClick={() => app.togglePlay()}
                onDragStart={(e) => {
                  e.dataTransfer?.setData("text/plain", s.path);
                  app.setDraggingId(s.id);
                }}
                onDragEnd={() => {
                  app.setDraggingId(null);
                  app.setDropTarget(null);
                }}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
