// Un arbre : sources (Bibliothèque) ou favoris / collections / dossiers virtuels (Virtuels). En colonne, l'onglet
// courant, dossiers et samples ; en mode grand, le panneau Library (dossiers seuls, sa sélection borne la liste par une
// chip `path:`) ou le panneau Virtual (éléments et samples, pour ranger et écouter ; il ne filtre jamais la liste).
import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, createEffect, createMemo, on, onCleanup } from "solid-js";
import type { FolderRow, Sample, SampleRow, TreeRoot } from "../api";
import { inTauri } from "../lib/env";
import { isMidi, relativePath } from "../lib/format";
import { notesLoader } from "../lib/notes";
import { targetAt } from "../lib/dragHover";
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
function markerFor(row: FolderRow, root: TreeRoot): TreeRowMarker | undefined {
  if (row.kind === "shortcut") return "shortcut";
  if (!row.pinned) return undefined;
  if (root === "virtual") return "pin";
  if (row.parent !== null) return undefined;
  return row.kind === "virtual" ? "virtual" : row.kind === "favorites" ? "favorites" : "collection";
}

/** Hauteur d'une ligne par taille de texte : compacte, et sample en densité « waveform » (tokens --cr-row-h*). */
export const ROW_H = { sm: 24, base: 24, lg: 26 } as const;
const ROW_H_WAVE = { sm: 36, base: 36, lg: 38 } as const;
export const PAD = 4; // --cr-space-1, en haut et en bas de l'arbre
/** Lignes montées au-delà de l'écran. `?overscan=1000` dans l'URL du prototype : tout monter (tests anciens). */
export const OVERSCAN = Number(new URLSearchParams(globalThis.location?.search ?? "").get("overscan")) || 20;

/** `side` : l'arbre de la colonne ; `explorer` : le panneau Library du mode grand ; `virtual` : son panneau Virtual. */
export type BrowserVariant = "side" | "explorer" | "virtual";

export function Browser(props: { model: ListModel; root: TreeRoot; variant: BrowserVariant }) {
  let scroller!: HTMLDivElement;
  const m = props.model;
  const explorer = () => props.variant === "explorer";
  // Le panneau Virtual du mode grand n'a jamais les pics (densité compacte, comme sa requête).
  const wave = () => app.density() === "wave" && props.variant === "side";
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
  // Bloc de la cible de dépôt : sa ligne et ses descendants visibles (les lignes sont en préordre, le bloc s'arrête à
  // la première ligne qui n'est pas plus profonde ; une case pas encore chargée en fait partie).
  const dropBlock = createMemo(() => {
    const t = app.dropTarget();
    const start = t && t !== "root" ? m.indexOf(t) : -1;
    const first = start >= 0 ? m.rowAt(start) : undefined;
    if (!first) return null;
    let end = start + 1;
    for (const total = m.shownTotal(); end < total; end++) {
      const r = m.rowAt(end);
      if (r && r.depth <= first.depth) break;
    }
    return { start, end };
  });
  const inBlock = (i: number) => {
    const b = dropBlock();
    return !!b && i >= b.start && i < b.end;
  };

  return (
    <div
      ref={(el) => {
        scroller = el;
        onCleanup(app.registerZone(props.root, el));
      }}
      class="cr-tree"
      data-virtual
      data-root={props.root}
      data-explorer={explorer() || undefined}
      data-focused={(app.listFocused() && app.zone() === props.root) || undefined}
      data-drop-target={(props.root === "virtual" && app.dropTarget() === "root") || undefined}
      data-drop-zone
      tabindex="0"
      role="tree"
      aria-multiselectable="true"
      aria-rowcount={m.shownTotal()}
      aria-label={explorer() ? "Folders" : props.root === "virtual" ? "Favorites, collections and virtual folders" : "Library"}
      onFocus={() => {
        app.setListFocused(true);
        app.setZone(props.root);
      }}
      onBlur={() => app.setListFocused(false)}
      onMouseDown={(e) => {
        // Fond du panneau Library : plus de portée, toute la bibliothèque (le panneau Virtual ne borne rien).
        if (explorer() && e.button === 0 && e.target === e.currentTarget) app.clearScope();
      }}
      // Glisser HTML (prototype, liste du mode grand) : la même cible que les autres glissers, ligne ou dossier parent.
      onDragOver={(e) => {
        const t = targetAt(e.target as Element);
        app.setDropTarget(t);
        if (!t) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) app.setDropTarget(null);
      }}
      onDrop={(e) => {
        const t = app.dropTarget();
        if (!t) return;
        e.preventDefault();
        void app.dropOn(t);
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget || props.root !== "virtual") return;
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
              <RowSlot model={m} root={props.root} index={item.index} explorer={explorer()} dropBlock={inBlock(item.index)} />
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
function RowSlot(props: { model: ListModel; root: TreeRoot; index: number; explorer: boolean; dropBlock: boolean }) {
  const row = () => props.model.rowAt(props.index);
  return (
    <Show when={row()} fallback={<div class="cr-node" aria-busy="true" data-drop-block={props.dropBlock || undefined} />}>
      <Show
        when={row()!.type === "node"}
        fallback={<SampleRowView model={props.model} row={row() as SampleRow} dropBlock={props.dropBlock} />}
      >
        <NodeRowView model={props.model} root={props.root} row={row() as FolderRow} explorer={props.explorer} dropBlock={props.dropBlock} />
      </Show>
    </Show>
  );
}

function NodeRowView(props: { model: ListModel; root: TreeRoot; row: FolderRow; explorer: boolean; dropBlock: boolean }) {
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
        marker={markerFor(props.row, props.root)}
        selected={props.model.cursor() === props.row.key}
        scoped={props.explorer && (props.row.target ?? props.row.key) === app.listScope()}
        dragging={app.draggingKey() === props.row.key}
        dropTarget={app.dropTarget() === props.row.key}
        dropBlock={props.dropBlock}
        renaming={app.renamingKey() === props.row.key}
        onRename={(name) => app.renameNode(props.row.key, name)}
        onContextMenu={(e) => {
          const p = panelPoint(e);
          app.openMenu(p.x, p.y, props.row.key);
        }}
        onToggle={() => app.toggleNode(props.row.key)}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          // Panneau Library : la ligne devient la portée (un raccourci vaut son dossier, sans y sauter).
          if (props.explorer) return app.selectExplorer(props.row.key);
          app.select(props.row.key, "replace", props.model);
          if (props.row.target) app.jumpTo(props.row.target);
        }}
        onDblClick={() => app.toggleNode(props.row.key)}
        onPointerDown={(e) => {
          // Dossier virtuel : glisser au pointeur (pas en HTML5, qui n'arrive pas dans la fenêtre Tauri).
          if (props.row.kind === "virtual" && app.renamingKey() !== props.row.key)
            beginFolderDrag(e, props.row.key, props.row.name);
        }}
      />
    );
}

/** Clic, double-clic, menu et glisser d'une ligne de sample : les mêmes dans les arbres et dans la liste du mode grand.
 *  `model` : la liste qui montre la ligne (elle reçoit la sélection). */
export function sampleRowHandlers(rowKey: () => string, sample: () => Sample, model: ListModel) {
  return {
    onMouseDown: (e: MouseEvent) => {
      if (e.button !== 0) return;
      app.select(rowKey(), e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace", model);
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
      if (!app.selection().includes(rowKey())) app.select(rowKey(), "replace", model);
      app.setDraggingKey(rowKey());
    },
    onDragEnd: () => {
      app.setDraggingKey(null);
      app.setDropTarget(null);
    },
  };
}

function SampleRowView(props: { model: ListModel; row: SampleRow; dropBlock: boolean }) {
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
      dropBlock={props.dropBlock}
      midi={isMidi(s())}
      fav={s().fav}
      peaks={s().peaks}
      loadNotes={isMidi(s()) ? notesLoader(s().id) : undefined}
      wave={app.density() === "wave" && app.layout() === "side"}
      themeKey={app.theme()}
      title={(s().missing ? "Missing: " : "") + relativePath(s().path, app.sources())}
      {...sampleRowHandlers(() => props.row.key, s, props.model)}
    />
  );
}
