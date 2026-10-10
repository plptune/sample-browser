// L'arbre de l'onglet courant : sources (Bibliothèque) ou favoris / collections / dossiers virtuels (Virtuels).
import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, createEffect, on } from "solid-js";
import type { FolderRow, SampleRow } from "../api";
import { inTauri } from "../lib/env";
import { formatDuration, formatFormat, isMidi } from "../lib/format";
import { startNativeDrag } from "../lib/nativeDrag";
import { app } from "../state/app";

/** Glisser natif : dans la fenêtre, sur de vrais fichiers (pas en démo, où les chemins sont factices). */
const nativeDrag = () => inTauri && !app.demo();
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

/** Hauteur d'une ligne par taille de texte : compacte, et sample en densité « waveform » (tokens --cr-row-h*). */
const ROW_H = { sm: 24, base: 24, lg: 26 } as const;
const ROW_H_WAVE = { sm: 36, base: 36, lg: 38 } as const;
const PAD = 4; // --cr-space-1, en haut et en bas de l'arbre
/** Lignes montées au-delà de l'écran. `?overscan=1000` dans l'URL du prototype : tout monter (tests anciens). */
const OVERSCAN = Number(new URLSearchParams(globalThis.location?.search ?? "").get("overscan")) || 20;

export function Browser() {
  let scroller!: HTMLDivElement;
  const wave = () => app.density() === "wave";
  const virtualizer = createVirtualizer({
    get count() {
      return app.shownTotal();
    },
    getScrollElement: () => scroller,
    estimateSize: (i) => (wave() && app.rowAt(i)?.type !== "node" ? ROW_H_WAVE : ROW_H)[app.fontSize()],
    overscan: OVERSCAN,
    paddingStart: PAD,
    paddingEnd: PAD,
    scrollPaddingStart: PAD,
    scrollPaddingEnd: PAD,
  });

  // Les lignes à l'écran demandent leurs pages ; une recherche ou un onglet neuf repart du haut.
  createEffect(() => {
    const items = virtualizer.getVirtualItems();
    if (items.length) app.setViewRange(items[0].index, items[items.length - 1].index + 1);
  });
  createEffect(on(app.scrollReset, () => virtualizer.scrollToOffset(0), { defer: true }));
  // Le curseur reste visible (flèches, sauts, historique).
  createEffect(
    on(app.cursor, (key) => {
      const i = app.indexOf(key);
      if (i >= 0) virtualizer.scrollToIndex(i, { align: "auto" });
    }),
  );
  // En densité « waveform », la hauteur dépend du type de ligne, connu une fois la page chargée.
  createEffect(
    on([app.rows, wave, app.fontSize], () => virtualizer.measure(), { defer: true }),
  );

  const dropRoot = (e: DragEvent) => {
    // Fond de l'onglet Virtuels : un dossier virtuel déposé ici remonte à la racine.
    if (app.tab() !== "virtual" || e.target !== e.currentTarget || !app.canDrop("root")) return;
    e.preventDefault();
    app.setDropTarget("root");
  };
  return (
    <>
      {/* Mode grand : en-têtes des colonnes (non triables), alignés sur celles des samples. */}
      <Show when={app.layout() === "full"}>
        <div class="cr-colhead" aria-hidden="true">
          <span class="cr-colhead__name">Nom</span>
          <span class="cr-col-dur">Durée</span>
          <span class="cr-col-fmt">Format</span>
          <span class="cr-col-tags">Tags</span>
          <span class="cr-col-bpm">BPM</span>
          <span class="cr-col-key">Clé</span>
        </div>
      </Show>
    <div
      ref={scroller}
      class="cr-tree"
      data-virtual
      data-focused={app.listFocused() || undefined}
      data-drop-target={app.dropTarget() === "root" || undefined}
      tabindex="0"
      role="tree"
      aria-multiselectable="true"
      aria-rowcount={app.shownTotal()}
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
      <div class="cr-tree__space" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        <For each={virtualizer.getVirtualItems()}>
          {(item) => (
            <div
              class="cr-tree__row"
              data-key={app.rowAt(item.index)?.key}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <RowSlot index={item.index} />
            </div>
          )}
        </For>
      </div>
    </div>
    </>
  );
}

/**
 * Une case de l'arbre : le même composant sert quand la ligne change (recherche, défilement d'une page à
 * l'autre) ; seules ses valeurs sont mises à jour, rien n'est recréé.
 */
function RowSlot(props: { index: number }) {
  const row = () => app.rowAt(props.index);
  return (
    <Show when={row()} fallback={<div class="cr-node" aria-busy="true" />}>
      <Show when={row()!.type === "node"} fallback={<SampleRowView row={row() as SampleRow} />}>
        <NodeRowView row={row() as FolderRow} />
      </Show>
    </Show>
  );
}

function NodeRowView(props: { row: FolderRow }) {
  return (
      <TreeRow
        kind={props.row.kind}
        label={props.row.name}
        depth={props.row.depth}
        open={props.row.open}
        title={props.row.target ? "Aller au dossier" : undefined}
        offline={props.row.offline ?? undefined}
        hidden={props.row.hidden ?? undefined}
        marker={markerFor(props.row)}
        selected={app.cursor() === props.row.key}
        draggable={props.row.kind === "virtual"}
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
          app.select(props.row.key);
          if (props.row.target) app.jumpTo(props.row.target);
        }}
        onDblClick={() => app.toggleNode(props.row.key)}
        onDragStart={(e) => {
          e.dataTransfer?.setData("text/plain", props.row.name);
          app.setDraggingKey(props.row.key);
        }}
        onDragEnd={() => {
          app.setDraggingKey(null);
          app.setDropTarget(null);
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

function SampleRowView(props: { row: SampleRow }) {
  const s = () => props.row.sample;
  return (
    <TreeRow
      kind="sample"
      label={s().name}
      depth={props.row.depth}
      selected={app.selection().includes(props.row.key)}
      playing={app.playingId() === s().id}
      progress={app.progress()}
      missing={s().missing}
      hidden={s().hidden}
      dragging={app.draggingKey() === props.row.key}
      midi={isMidi(s())}
      wide={app.layout() === "full"}
      duration={formatDuration(s().durationMs)}
      format={formatFormat(s())}
      tags={s().tags}
      bpm={s().bpm}
      keyName={s().key}
      peaks={s().peaks}
      wave={app.density() === "wave"}
      themeKey={app.theme()}
      title={s().missing ? `Introuvable : ${s().path}` : s().path}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        app.select(props.row.key, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
      }}
      onDblClick={() => app.togglePlay()}
      onContextMenu={(e) => {
        const p = panelPoint(e);
        app.openMenu(p.x, p.y, props.row.key);
      }}
      onDragStart={(e) => {
        if (nativeDrag()) {
          // Fenêtre Tauri : glisser natif de fichiers (DAW, Finder) à la place du glisser HTML.
          e.preventDefault();
          void startNativeDrag(props.row.key);
          return;
        }
        if (app.stopOnDrag() && app.playingId() !== null) app.stop();
        e.dataTransfer?.setData("text/plain", s().path);
        // Glisser une ligne hors sélection la sélectionne d'abord, comme dans le Finder.
        if (!app.selection().includes(props.row.key)) app.select(props.row.key);
        app.setDraggingKey(props.row.key);
      }}
      onDragEnd={() => {
        app.setDraggingKey(null);
        app.setDropTarget(null);
      }}
    />
  );
}
