import { Match, Show, Switch } from "solid-js";
import type { TreeRow as Row } from "../api";
import { app } from "../state/app";
import { Browser } from "./Browser";
import { CommitView } from "./CommitView";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { Inspector } from "./Inspector";
import { DEFAULT_COLORS } from "../lib/color";
import { relativeFolder } from "../lib/format";
import { PreviewDrawer } from "./PreviewDrawer";
import { SaveSearch } from "./SaveSearch";
import { ScanStatus } from "./ScanStatus";
import { SearchField } from "./SearchField";
import { SettingsView } from "./SettingsView";
import { Tabs } from "./Tabs";
import { TagPopover, type TagState } from "./TagPopover";

const ms = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ms`;
const num = (x: number) => x.toLocaleString("en-US");

/** ⌥⌘D : mesures de la dernière requête d'arbre (budget : 16 ms de la frappe à l'image). */
function DebugOverlay() {
  return (
    <div class="cr-scan cr-debug cr-num" role="status" aria-label="Metrics">
      <Show when={app.metrics()} fallback={<span class="cr-scan__label">Metrics: waiting for a query</span>}>
        {(m) => (
          <span class="cr-scan__label">
            tree {ms(m().rust)} · ipc {ms(m().ipc - m().rust)} · render {ms(m().dom)}
            <br />
            total {ms(m().ipc + m().dom)} (+ frame {ms(m().frame)}) · {num(m().rows)} rows
            <Show when={app.latency() !== null}> · sound {ms(app.latency()!)}</Show>
          </span>
        )}
      </Show>
    </div>
  );
}

/** Message bref (source refusée…) : disparaît seul, ou au clic. */
function Notice() {
  return (
    <Show when={app.notice()}>
      {(t) => (
        <div class="cr-scan cr-notice" role="alert" onClick={() => app.setNotice(null)}>
          <span class="cr-scan__label">{t()}</span>
        </div>
      )}
    </Show>
  );
}

/** Chemin lisible d'un dossier virtuel (« Pack 2026 › Drums »). */
function vfPath(id: number): string {
  const all = app.library()?.virtualFolders ?? [];
  const parts: string[] = [];
  for (let f = all.find((x) => x.id === id); f; f = f.parentId === null ? undefined : all.find((x) => x.id === f!.parentId)) parts.unshift(f.name);
  return parts.join(" › ");
}

const pinItem = (key: string, pinned: boolean | null | undefined): MenuItem => ({
  label: pinned ? "Hide from Library" : "Show in Library",
  action: () => app.togglePin(key),
});

/** Aplatir un dossier (filtre temporaire) : tous ses samples, sans sous-dossiers. Pas pendant une recherche. */
const flattenItem = (row: { key: string; flattened?: boolean | null }): MenuItem =>
  row.flattened
    ? { label: "Unflatten", action: () => app.flatten(row.key, false) }
    : { label: "Flatten", disabled: app.searching(), action: () => app.flatten(row.key) };
const commitItem = (key: string): MenuItem => ({ label: "Create a real folder…", action: () => app.openCommit(key) });

/** Entrées du menu contextuel selon la ligne visée ("root" : fond de l'onglet Virtuels). */
function menuFor(row: Row | undefined): MenuItem[] {
  if (!row) return [
    { label: "New virtual folder", shortcut: "⌘N", action: () => app.newVirtualFolder() },
    { label: "New collection", action: () => app.newCollection() },
  ];
  if (row.type === "sample") {
    const n = Math.max(1, app.selection().length);
    const lib = app.library();
    const manual = lib?.collections.filter((c) => c.kind === "manual") ?? [];
    const vfs = [...(lib?.virtualFolders ?? [])].map((f) => ({ id: f.id, path: vfPath(f.id) })).sort((a, b) => a.path.localeCompare(b.path));
    const parent = row.parent;
    const removable = parent.startsWith("v:") || (parent.startsWith("c:") && (parent === "c:fav" || manual.some((c) => `c:${c.id}` === parent)));
    return [
      { label: app.playingId() === row.sample.id ? "Stop" : "Play", shortcut: "Space", action: () => app.togglePlay(), disabled: row.sample.missing },
      { label: n > 1 ? `Tag ${n} samples…` : "Tag…", shortcut: "T", action: () => app.openTagging() },
      {
        label: app.selectedSamples().every((s) => s.fav) ? "Remove from favorites" : "Add to favorites",
        shortcut: "⌘D",
        action: () => app.toggleFavorite(),
      },
      ...(removable
        ? [{ label: `Remove from “${app.nodeName(parent)}”`, shortcut: "⌘⌫", action: () => app.removeSelectionFrom(parent) } as MenuItem]
        : []),
      // Masquer : jamais de suppression ; « is:hidden » les retrouve, « Afficher » annule.
      app.selectedSamples().every((s) => s.hidden)
        ? { label: "Unhide", action: () => app.hideSelection(false) }
        : { label: n > 1 ? `Hide ${n} samples` : "Hide", shortcut: removable ? undefined : "⌘⌫", action: () => app.hideSelection(true) },
      { type: "separator" },
      { type: "header", label: "Add to collection" },
      ...manual.map((c): MenuItem => ({ label: c.name, action: () => app.addSelectionTo(`c:${c.id}`) })),
      { type: "header", label: "Add to virtual folder" },
      ...vfs.map((f): MenuItem => ({ label: f.path, action: () => app.addSelectionTo(`v:${f.id}`) })),
      { type: "separator" },
      { label: "Show in Finder", shortcut: "⌥⌘R", action: () => app.showInFinder(row.sample.path), disabled: row.sample.missing },
      { label: "Copy path", action: () => navigator.clipboard?.writeText(row.sample.path) },
    ];
  }
  const toggle: MenuItem = { label: row.open ? "Collapse" : "Expand", shortcut: "⏎", action: () => app.toggleNode(row.key) };
  switch (row.kind) {
    case "shortcut":
      return [
        { label: "Go to folder", shortcut: "⏎", action: () => app.jumpTo(row.target!) },
        { label: "Open in Finder", shortcut: "⌥⌘R", action: () => app.openFolderInFinder(row.key) },
        { type: "separator" },
        { label: "Remove from Library", action: () => app.togglePin(row.key) },
      ];
    case "folder": {
      if (row.parent === null && app.tab() === "library") {
        return [
          toggle,
          flattenItem(row),
          { label: "Refresh", action: () => app.refreshSource(+row.key.slice(2)) },
          { label: "Open in Finder", shortcut: "⌥⌘R", action: () => app.openFolderInFinder(row.key), disabled: !!row.offline },
          { type: "separator" },
          { label: "Remove source", danger: true, action: () => app.removeSource(+row.key.slice(2)) },
        ];
      }
      const pinned = app.library()?.pinnedFolders.includes(+row.key.slice(2));
      return [
        toggle,
        flattenItem(row),
        { label: pinned ? "Remove from Library" : "Pin to Library", action: () => app.togglePin(row.key) },
        { label: "Open in Finder", shortcut: "⌥⌘R", action: () => app.openFolderInFinder(row.key) },
        { type: "separator" },
        row.hidden
          ? { label: "Unhide folder", action: () => app.hideFolder(row.key, false) }
          : { label: "Hide folder", shortcut: "⌘⌫", action: () => app.hideFolder(row.key, true) },
      ];
    }
    case "favorites":
      return [toggle, pinItem(row.key, row.pinned), { type: "separator" }, commitItem(row.key)];
    case "group":
      return [toggle, { type: "separator" }, { label: "New collection", action: () => app.newCollection() }];
    case "virtual": {
      // « Déplacer dans » : le pendant clavier du glisser (ni soi-même, ni un descendant, ni le parent actuel).
      const all = app.library()?.virtualFolders ?? [];
      const id = +row.key.slice(2);
      const self = all.find((f) => f.id === id);
      const inside = (f: { id: number; parentId: number | null }): boolean => {
        for (let p: typeof f | undefined = f; p; p = p.parentId === null ? undefined : all.find((x) => x.id === p!.parentId)) if (p.id === id) return true;
        return false;
      };
      const dests = all
        .filter((f) => !inside(f) && f.id !== self?.parentId)
        .map((f) => ({ id: f.id, path: vfPath(f.id) }))
        .sort((a, b) => a.path.localeCompare(b.path));
      const moves: MenuItem[] = [
        ...(self?.parentId != null ? [{ label: "Top level", action: () => app.moveVirtualFolderTo(row.key, null) } as MenuItem] : []),
        ...dests.map((f): MenuItem => ({ label: f.path, action: () => app.moveVirtualFolderTo(row.key, `v:${f.id}`) })),
      ];
      return [
        toggle,
        flattenItem(row),
        { label: "New virtual folder inside", action: () => app.newVirtualFolder(row.key) },
        { label: "Rename", action: () => app.setRenamingKey(row.key) },
        pinItem(row.key, row.pinned),
        ...(moves.length ? [{ type: "separator" } as MenuItem, { type: "header", label: "Move to" } as MenuItem, ...moves] : []),
        { type: "separator" },
        commitItem(row.key),
        { type: "separator" },
        { label: "Delete virtual folder", danger: true, action: () => app.deleteNode(row.key) },
      ];
    }
    default:
      return [
        toggle,
        { label: "Rename", action: () => app.setRenamingKey(row.key) },
        pinItem(row.key, row.pinned),
        { type: "separator" },
        commitItem(row.key),
        { type: "separator" },
        { label: "Delete collection", danger: true, action: () => app.deleteNode(row.key) },
      ];
  }
}

/** Tags proposés dans le popover, avec leur état sur la sélection. */
function tagChoices() {
  const samples = app.selectedSamples();
  return (app.library()?.tags ?? []).map((t) => {
    const n = samples.filter((s) => s.tags.includes(t.name)).length;
    const state: TagState = n === 0 ? "none" : n === samples.length ? "all" : "some";
    return { name: t.name, state };
  });
}

export function PanelShell(props: { searchRef?: (el: HTMLInputElement) => void; forceAc?: boolean }) {
  return (
    <div class="cr-panel cr-root" data-density={app.density()} data-layout={app.layout()} data-font-size={app.fontSize()}>
      <header class="cr-titlebar" data-tauri-drag-region>
        <Tabs
          value={app.tab()}
          items={[
            { value: "library", label: "Library", shortcut: "⌘1", icon: "library" },
            { value: "virtual", label: "Virtual", shortcut: "⌘2", icon: "layers" },
          ]}
          iconOnly={app.layout() === "side"}
          springLoaded={app.draggingKey() !== null}
          onChange={(t) => app.switchTab(t)}
        />
        <span class="cr-titlebar__fill" data-tauri-drag-region />
        <Show when={app.tab() === "virtual" && app.view() === "browser" && !app.empty()}>
          <IconButton icon="plus" label="New virtual folder (⌘N)" onClick={() => app.newVirtualFolder()} />
        </Show>
        <IconButton
          icon={app.layout() === "full" ? "collapse" : "expand"}
          label={app.layout() === "full" ? "Back to column (⌘⇧F)" : "Expand (⌘⇧F)"}
          onClick={() => void app.toggleLayout()}
        />
        <IconButton
          icon="settings"
          label="Settings (⌘,)"
          active={app.view() === "settings"}
          onClick={() => app.setView(app.view() === "settings" ? "browser" : "settings")}
        />
      </header>

      <Switch>
        {/* Bibliothèque vide : l'écran de dépôt, sauf si l'on a ouvert les Réglages (ajouter une source, thème…). */}
        <Match when={app.empty() && app.view() !== "settings"}>
          <Notice />
          <EmptyState
            variant="drop"
            over={app.fileOver()}
            onClick={() => !app.demo() && app.addFolder()}
            title="Drop a folder here"
            body={
              <>
                Crate indexes your samples without moving them.
                <br />
                or <kbd class="cr-kbd">⌘O</kbd> to choose a folder
              </>
            }
          />
        </Match>
        <Match when={app.view() === "settings"}>
          <SettingsView
            sources={app.sources()}
            analysis={app.analysis()}
            theme={app.themePref()}
            density={app.density()}
            alwaysOnTop={app.alwaysOnTop()}
            autoPlay={app.autoPlay()}
            onBack={() => app.setView("browser")}
            onTheme={app.setTheme}
            onDensity={app.setDensity}
            onAlwaysOnTop={app.setAlwaysOnTop}
            onAutoPlay={app.setAutoPlay}
            looping={app.looping()}
            onLooping={app.setLooping}
            volume={app.volume()}
            onVolume={app.setVolume}
            stopOnDrag={app.stopOnDrag()}
            onStopOnDrag={app.setStopOnDrag}
            stopOnBlur={app.stopOnBlur()}
            onStopOnBlur={app.setStopOnBlur}
            onRemoveSource={app.removeSource}
            onAddSource={() => app.addFolder()}
            synonyms={app.synonyms()}
            onSynonyms={app.saveSynonyms}
            fontSize={app.fontSize()}
            onFontSize={app.setFontSize}
            colors={{ ...DEFAULT_COLORS[app.theme()], ...app.colors() }}
            customColors={app.colors()}
            onColor={app.setColor}
            onResetColors={app.resetColors}
            dawShortcut={app.dawShortcut()}
            onDawShortcut={app.setDawShortcut}
          />
        </Match>
        <Match when={app.view() === "commit" && app.commit()}>
          {(c) => (
            <CommitView
              name={c().name}
              flat={c().flat}
              destination={c().destination}
              options={c().options}
              plan={c().plan}
              status={c().status}
              progress={c().progress}
              result={c().result}
              onBack={() => app.closeCommit()}
              onDestination={app.setCommitDestination}
              onOptions={app.setCommitOptions}
              onChoose={() => app.chooseCommitParent()}
              error={c().error}
              onCommit={() => app.runCommit()}
              onReveal={() => app.showInFinder(c().result?.destination)}
            />
          )}
        </Match>
        <Match when={true}>
          <SearchField ref={props.searchRef} forceAc={props.forceAc && !app.tagging()} />
          <Show when={app.saving() !== null}>
            <SaveSearch value={app.saving()!} onSubmit={app.saveSearch} onCancel={() => app.setSaving(null)} />
          </Show>
          <Show when={app.scan()}>{(s) => <ScanStatus folder={s().folder} done={s().done} total={s().total} />}</Show>
          <Notice />
          {/* Mode colonne : l'arbre puis le tiroir. Mode grand : l'arbre à gauche, l'inspecteur à droite.
              L'arbre reste le même élément d'un mode à l'autre (rien n'est recréé). */}
          <div class="cr-split">
            <div class="cr-split__main">
              <Show
                when={app.shownTotal()}
                fallback={
                  <EmptyState
                    variant="noresults"
                    title="No results"
                    body={<>Nothing matches “{app.queryLine()}”.</>}
                    hints={["kick dark", "#warm -#bright", "bpm:120-128 key:Am", "dur:<1s type:oneshot"]}
                  />
                }
              >
                <Browser />
              </Show>
              <Show when={app.debug()}>
                <DebugOverlay />
              </Show>
            </div>
            <Show when={app.layout() === "full"}>
              <Inspector
                sample={app.current()}
                peaks={app.currentPeaks()}
                playing={app.playingId() !== null && app.playingId() === app.current()?.id}
                progress={app.progress()}
                looping={app.looping()}
                loadDetail={(b) => (app.current() ? app.waveformFor(app.current()!.id, b) : Promise.resolve({ min: [], max: [], rms: [] }))}
                themeKey={app.theme()}
                selectionCount={app.selectedSamples().length}
                memberships={app.memberships()}
                onTogglePlay={() => app.togglePlay()}
                onToggleFav={() => app.toggleFavorite(app.selectedSamples().length ? app.selectedSamples() : [app.current()!])}
                onSeek={app.seekTo}
                onRemoveTag={(t) => void app.removeTag(t)}
                onAddTag={() => app.openTagging()}
                onJump={(k) => void app.jumpTo(k)}
                onReveal={() => app.showInFinder(app.current()?.path)}
              />
            </Show>
          </div>
          <Show when={app.layout() !== "full"}>
            <PreviewDrawer
              sample={app.current()}
              peaks={app.currentPeaks()}
              playing={app.playingId() !== null && app.playingId() === app.current()?.id}
              progress={app.progress()}
              themeKey={app.theme()}
              autoPlay={app.autoPlay()}
              looping={app.looping()}
              folder={app.current() ? relativeFolder(app.current()!.path, app.sources()) : ""}
              loadDetail={(b) => (app.current() ? app.waveformFor(app.current()!.id, b) : Promise.resolve({ min: [], max: [], rms: [] }))}
              knownTags={app.library()?.tags.map((t) => ({ label: t.name, count: t.count })) ?? []}
              onTogglePlay={() => app.togglePlay()}
              onToggleFav={() => app.current() && app.toggleFavorite([app.current()!])}
              onAutoPlay={app.setAutoPlay}
              onAddTag={(t) => void app.addTag(t)}
              onRemoveTag={(t) => void app.removeTag(t)}
              onSeek={app.seekTo}
            />
          </Show>
          <Show when={app.tagging()}>
            <TagPopover
              count={app.selectedSamples().length}
              tags={tagChoices()}
              onToggle={app.toggleTag}
              onClose={() => {
                app.setTagging(false);
                document.querySelector<HTMLElement>(".cr-tree")?.focus();
              }}
            />
          </Show>
        </Match>
      </Switch>

      <Show when={app.menu()}>
        {(m) => {
          const row = m().rowKey === "root" ? undefined : app.rowByKey(m().rowKey);
          if (m().rowKey !== "root" && !row) return null;
          return <ContextMenu x={m().x} y={m().y} items={menuFor(row)} onClose={() => app.setMenu(null)} />;
        }}
      </Show>
    </div>
  );
}
