// L'arbre de l'onglet courant : sources (Bibliothèque) ou favoris / collections / dossiers virtuels (Virtuels).
import { For, createEffect } from "solid-js";
import type { FolderRow } from "../api";
import { app } from "../state/app";
import { TreeRow, type TreeRowMarker } from "./TreeRow";

/** Coordonnées d'un clic relatives au panneau (le menu y est positionné en absolu). */
function panelPoint(e: MouseEvent) {
  const panel = (e.currentTarget as HTMLElement).closest(".cr-panel")!.getBoundingClientRect();
  return { x: e.clientX - panel.left, y: e.clientY - panel.top };
}

/**
 * Repère à droite d'un nœud : dans Bibliothèque, la nature d'un élément épinglé (il n'est pas sur le disque) ;
 * dans Virtuels, une épingle pour ce qui est aussi affiché dans Bibliothèque.
 */
function markerFor(row: FolderRow): TreeRowMarker | undefined {
  if (row.kind === "shortcut") return "shortcut";
  if (!row.pinned) return undefined;
  if (app.tab() === "virtual") return "pin";
  if (row.parent !== null) return undefined;
  return row.kind === "virtual" ? "virtual" : row.kind === "favorites" ? "favorites" : "collection";
}

export function Browser() {
  const dropRoot = (e: DragEvent) => {
    // Fond de l'onglet Virtuels : un dossier virtuel déposé ici remonte à la racine.
    if (app.tab() !== "virtual" || e.target !== e.currentTarget || !app.canDrop("root")) return;
    e.preventDefault();
    app.setDropTarget("root");
  };
  return (
    <div
      class="cr-tree"
      data-focused={app.listFocused() || undefined}
      data-drop-target={app.dropTarget() === "root" || undefined}
      tabindex="0"
      role="tree"
      aria-multiselectable="true"
      aria-label={app.tab() === "virtual" ? "Favoris, collections et dossiers virtuels" : "Bibliothèque"}
      onFocus={() => app.setListFocused(true)}
      onBlur={() => app.setListFocused(false)}
      onDragOver={dropRoot}
      onDragLeave={(e) => e.target === e.currentTarget && app.dropTarget() === "root" && app.setDropTarget(null)}
      onDrop={(e) => {
        if (app.dropTarget() !== "root") return;
        e.preventDefault();
        app.dropOn("root");
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget || app.tab() !== "virtual") return;
        e.preventDefault();
        const p = panelPoint(e);
        app.openMenu(p.x, p.y, "root");
      }}
    >
      <For each={app.visible()}>
        {(row) => {
          let el!: HTMLDivElement;
          createEffect(() => {
            if (app.cursor() === row.key) el?.scrollIntoView({ block: "nearest" });
          });
          if (row.type === "node") {
            return (
              <TreeRow
                ref={(r) => (el = r)}
                kind={row.kind}
                label={row.name}
                depth={row.depth}
                open={row.open}
                title={row.target ? "Aller au dossier" : undefined}
                offline={row.offline ?? undefined}
                marker={markerFor(row)}
                selected={app.cursor() === row.key}
                draggable={row.kind === "virtual"}
                dragging={app.draggingKey() === row.key}
                dropTarget={app.dropTarget() === row.key}
                renaming={app.renamingKey() === row.key}
                onRename={(name) => app.renameNode(row.key, name)}
                onContextMenu={(e) => {
                  const p = panelPoint(e);
                  app.openMenu(p.x, p.y, row.key);
                }}
                onToggle={() => app.toggleNode(row.key)}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  app.select(row.key);
                  if (row.target) app.jumpTo(row.target);
                }}
                onDblClick={() => app.toggleNode(row.key)}
                onDragStart={(e) => {
                  e.dataTransfer?.setData("text/plain", row.name);
                  app.setDraggingKey(row.key);
                }}
                onDragEnd={() => {
                  app.setDraggingKey(null);
                  app.setDropTarget(null);
                }}
                onDragOver={(e) => {
                  if (!app.canDrop(row.key)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  app.setDropTarget(row.key);
                }}
                onDragLeave={() => app.dropTarget() === row.key && app.setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  app.dropOn(row.key);
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
              onContextMenu={(e) => {
                const p = panelPoint(e);
                app.openMenu(p.x, p.y, row.key);
              }}
              onDragStart={(e) => {
                e.dataTransfer?.setData("text/plain", s.path);
                // Glisser une ligne hors sélection la sélectionne d'abord, comme dans le Finder.
                if (!app.selection().includes(row.key)) app.select(row.key);
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
