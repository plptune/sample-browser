// La vue unique : arborescence des sources, dont les dossiers s'ouvrent sur leurs samples.
import { For, createEffect } from "solid-js";
import { app } from "../state/app";
import { TreeRow } from "./TreeRow";

export function Browser() {
  return (
    <div
      class="cr-tree"
      data-focused={app.listFocused() || undefined}
      tabindex="0"
      role="tree"
      aria-multiselectable="true"
      aria-label="Samples"
      onFocus={() => app.setListFocused(true)}
      onBlur={() => app.setListFocused(false)}
    >
      <For each={app.visible()}>
        {(row) => {
          let el!: HTMLDivElement;
          createEffect(() => {
            if (app.cursor() === row.key) el?.scrollIntoView({ block: "nearest" });
          });
          if (row.type === "node") {
            const manual = row.kind === "collection";
            return (
              <TreeRow
                ref={(r) => (el = r)}
                kind={row.kind}
                label={row.name}
                depth={row.depth}
                open={row.open}
                offline={row.offline}
                selected={app.cursor() === row.key}
                dropTarget={app.dropTarget() === row.key}
                onToggle={() => app.toggleNode(row.key)}
                onMouseDown={(e) => e.button === 0 && app.select(row.key)}
                onDblClick={() => app.toggleNode(row.key)}
                onDragOver={(e) => {
                  if (!manual) return;
                  e.preventDefault();
                  app.setDropTarget(row.key);
                }}
                onDragLeave={() => app.setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  app.setDropTarget(null);
                }}
              />
            );
          }
          const s = row.sample;
          return (
            <TreeRow
              ref={(r) => (el = r)}
              kind="sample"
              label={s.name}
              depth={row.depth}
              selected={app.selection().includes(row.key)}
              playing={app.playingId() === s.id}
              progress={app.progress()}
              missing={s.missing}
              dragging={app.draggingKey() === row.key}
              bpm={s.bpm}
              keyName={s.key}
              peaks={s.peaks}
              wave={app.density() === "wave"}
              themeKey={app.theme()}
              title={s.missing ? `Introuvable : ${s.path}` : s.path}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                app.select(row.key, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
              }}
              onDblClick={() => app.togglePlay()}
              onDragStart={(e) => {
                e.dataTransfer?.setData("text/plain", s.path);
                app.setDraggingKey(row.key);
              }}
              onDragEnd={() => {
                app.setDraggingKey(null);
                app.setDropTarget(null);
              }}
            />
          );
        }}
      </For>
    </div>
  );
}
