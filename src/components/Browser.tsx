// L'arbre de l'onglet courant : sources (Bibliothèque) ou favoris / collections / dossiers virtuels (Virtuels). En
// colonne, dossiers et samples ; en mode grand, l'explorer (dossiers seuls), dont la sélection est la portée de la liste.
import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, createEffect, on } from "solid-js";
import type { FolderRow, Sample, SampleRow } from "../api";
import { inTauri } from "../lib/env";
import { isMidi, relativePath } from "../lib/format";
import { beginFolderDrag } from "../lib/folderDrag";
import { startNativeDrag } from "../lib/nativeDrag";
import { app } from "../state/app";
import type { ListModel } from "../state/listModel";

/** Glisser natif : dans la fenêtre, sur de vrais fichiers (pas en démo, où les chemins sont factices). */
const nativeDrag = () => inTauri && !app.demo();
import { TreeRow, type TreeRowMarker } from "./TreeRow";

/** Coordonnées d'un clic relatives au panneau (le menu y est positionné en absolu). */
export function panelPoint(e: MouseEvent) {
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

/** Hauteur d'une ligne par taille de texte : compacte, et sample en densité « waveform » (tokens --cr-row-h*). */
export const ROW_H = { sm: 24, base: 24, lg: 26 } as const;
const ROW_H_WAVE = { sm: 36, base: 36, lg: 38 } as const;
export const PAD = 4; // --cr-space-1, en haut et en bas de l'arbre
/** Lignes montées au-delà de l'écran. `?overscan=1000` dans l'URL du prototype : tout monter (tests anciens). */
export const OVERSCAN = Number(new URLSearchParams(globalThis.location?.search ?? "").get("overscan")) || 20;

export function Browser(props: { model: ListModel; variant?: "side" | "explorer" }) {
  let scroller!: HTMLDivElement;
  const m = props.model;
  const explorer = () => props.variant === "explorer";
  const wave = () => app.density() === "wave" && !explorer();
  const virtualizer = createVirtualizer({
    get count() {
      return m.shownTotal();
    },
    getScrollElement: () => scroller,
    estimateSize: (i) => (wave() && m.rowAt(i)?.type !== "node" ? ROW_H_WAVE : ROW_H)[app.fontSize()],
    overscan: OVERSCAN,
    paddingStart: PAD,
    paddingEnd: PAD,
    scrollPaddingStart: PAD,
    scrollPaddingEnd: PAD,
  });

  // Les lignes à l'écran demandent leurs pages ; une recherche ou un onglet neuf repart du haut.
  createEffect(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length) m.setViewRange(items[0].index, items[items.length - 1].index + 1);
  });
  createEffect(on(m.scrollReset, () => virtualizer.scrollToOffset(0), { defer: true }));
  // Le curseur reste visible (flèches, sauts, historique).
  createEffect(
    on(m.cursor, (key) => {
      const i = m.indexOf(key);
      if (i >= 0) virtualizer.scrollToIndex(i, { align: "auto" });
    }),
  );
  // En densité « waveform », la hauteur dépend du type de ligne, connu une fois la page chargée.
  createEffect(
    on([m.rows, wave, app.fontSize], () => virtualizer.measure(), { defer: true }),
  );

  return (
    <div
      ref={(el) => {
        scroller = el;
        app.registerZone("tree", el);
      }}
      class="cr-tree"
      data-virtual
      data-explorer={explorer() || undefined}
      data-focused={(app.listFocused() && app.zone() === "tree") || undefined}
      data-drop-target={app.dropTarget() === "root" || undefined}
      tabindex="0"
      role="tree"
      aria-multiselectable="true"
      aria-rowcount={app.shownTotal()}
      aria-label={explorer() ? "Folders" : app.tab() === "virtual" ? "Favorites, collections and virtual folders" : "Library"}
      onFocus={() => {
        app.setListFocused(true);
        app.setZone("tree");
      }}
      onBlur={() => app.setListFocused(false)}
      onMouseDown={(e) => {
        // Fond de l'explorer : plus de portée, toute la bibliothèque.
        if (explorer() && e.button === 0 && e.target === e.currentTarget) app.clearScope();
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget || app.tab() !== "virtual") return;
        e.preventDefault();
        const p = panelPoint(e);
        app.openMenu(p.x, p.y, "root");
      }}
    >
      <div class="cr-tree__space" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        <For each={virtualizer.getVirtualItems()}>
          {(item) => (
            <div
              class="cr-tree__row"
              data-key={m.rowAt(item.index)?.key}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <RowSlot model={m} index={item.index} explorer={explorer()} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/**
 * Une case de l'arbre : le même composant sert quand la ligne change (recherche, défilement d'une page à
 * l'autre) ; seules ses valeurs sont mises à jour, rien n'est recréé.
 */
function RowSlot(props: { model: ListModel; index: number; explorer: boolean }) {
  const row = () => props.model.rowAt(props.index);
  return (
    <Show when={row()} fallback={<div class="cr-node" aria-busy="true" />}>
      <Show when={row()!.type === "node"} fallback={<SampleRowView model={props.model} row={row() as SampleRow} />}>
        <NodeRowView model={props.model} row={row() as FolderRow} explorer={props.explorer} />
      </Show>
    </Show>
  );
}

function NodeRowView(props: { model: ListModel; row: FolderRow; explorer: boolean }) {
  return (
      <TreeRow
        kind={props.row.kind}
        label={props.row.name}
        depth={props.row.depth}
        open={props.row.open}
        title={props.row.target ? "Go to folder" : undefined}
        offline={props.row.offline ?? undefined}
        flattened={props.row.flattened ?? undefined}
        hidden={props.row.hidden ?? undefined}
        leaf={props.row.leaf ?? undefined}
        marker={markerFor(props.row)}
        selected={props.model.cursor() === props.row.key}
        scoped={props.explorer && (props.row.target ?? props.row.key) === app.scope()}
        dragging={app.draggingKey() === props.row.key}
        dropTarget={app.dropTarget() === props.row.key}
        renaming={app.renamingKey() === props.row.key}
        onRename={(name) => app.renameNode(props.row.key, name)}
        onContextMenu={(e) => {
          const p = panelPoint(e);
          app.openMenu(p.x, p.y, props.row.key);
        }}
        onToggle={() => app.toggleNode(props.row.key)}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          // Explorer : la ligne devient la portée (un raccourci vaut son dossier, sans y sauter).
          if (props.explorer) return app.selectExplorer(props.row.key);
          app.select(props.row.key);
          if (props.row.target) app.jumpTo(props.row.target);
        }}
        onDblClick={() => app.toggleNode(props.row.key)}
        onPointerDown={(e) => {
          // Dossier virtuel : glisser au pointeur (pas en HTML5, qui n'arrive pas dans la fenêtre Tauri).
          if (props.row.kind === "virtual" && app.renamingKey() !== props.row.key)
            beginFolderDrag(e, props.row.key, props.row.name);
        }}
        onDragOver={(e) => {
          if (!app.canDrop(props.row.key)) return;
          e.preventDefault();
          e.stopPropagation();
          app.setDropTarget(props.row.key);
        }}
        onDragLeave={() => app.dropTarget() === props.row.key && app.setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          app.dropOn(props.row.key);
        }}
      />
    );
}

/** Clic, double-clic, menu et glisser d'une ligne de sample : les mêmes dans l'arbre et dans la liste du mode grand. */
export function sampleRowHandlers(rowKey: () => string, sample: () => Sample) {
  return {
    onMouseDown: (e: MouseEvent) => {
      if (e.button !== 0) return;
      app.select(rowKey(), e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
    },
    onDblClick: () => app.togglePlay(),
    onContextMenu: (e: MouseEvent) => {
      const p = panelPoint(e);
      app.openMenu(p.x, p.y, rowKey());
    },
    onDragStart: (e: DragEvent) => {
      if (nativeDrag()) {
        // Fenêtre Tauri : glisser natif de fichiers (DAW, Finder) à la place du glisser HTML.
        e.preventDefault();
        void startNativeDrag(rowKey());
        return;
      }
      if (app.stopOnDrag() && app.playingId() !== null) app.stop();
      e.dataTransfer?.setData("text/plain", sample().path);
      // Glisser une ligne hors sélection la sélectionne d'abord, comme dans le Finder.
      if (!app.selection().includes(rowKey())) app.select(rowKey());
      app.setDraggingKey(rowKey());
    },
    onDragEnd: () => {
      app.setDraggingKey(null);
      app.setDropTarget(null);
    },
  };
}

function SampleRowView(props: { model: ListModel; row: SampleRow }) {
  const s = () => props.row.sample;
  return (
    <TreeRow
      kind="sample"
      label={`${s().name}.${s().ext}`}
      depth={props.row.depth}
      selected={props.model.selection().includes(props.row.key)}
      playing={app.playingId() === s().id}
      progress={app.progress()}
      missing={s().missing}
      hidden={s().hidden}
      dragging={app.draggingKey() === props.row.key}
      midi={isMidi(s())}
      peaks={s().peaks}
      wave={app.density() === "wave"}
      themeKey={app.theme()}
      title={(s().missing ? "Missing: " : "") + relativePath(s().path, app.sources())}
      {...sampleRowHandlers(() => props.row.key, s)}
    />
  );
}
