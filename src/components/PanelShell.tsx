import { Match, Show, Switch } from "solid-js";
import type { TreeRow as Row } from "../api";
import { app } from "../state/app";
import { Browser } from "./Browser";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { PreviewDrawer } from "./PreviewDrawer";
import { SaveSearch } from "./SaveSearch";
import { ScanStatus } from "./ScanStatus";
import { SearchField } from "./SearchField";
import { SettingsView } from "./SettingsView";
import { TagPopover, type TagState } from "./TagPopover";

/** Entrées du menu contextuel selon la ligne visée. */
function menuFor(row: Row): MenuItem[] {
  if (row.type === "sample") {
    const n = Math.max(1, app.selection().length);
    const manual = app.library()?.collections.filter((c) => c.kind === "manual") ?? [];
    return [
      { label: app.playingId() === row.sample.id ? "Stop" : "Lire", shortcut: "Espace", action: () => app.togglePlay(), disabled: row.sample.missing },
      { label: n > 1 ? `Taguer ${n} samples…` : "Taguer…", shortcut: "T", action: () => app.openTagging() },
      { type: "separator" },
      { type: "header", label: "Ajouter à" },
      ...manual.map((c): MenuItem => ({ label: c.name, action: () => app.dropOnCollection(`c:${c.id}`) })),
      { type: "separator" },
      { label: "Révéler dans le Finder", action: () => void 0 },
      { label: "Copier le chemin", action: () => navigator.clipboard?.writeText(row.sample.path) },
    ];
  }
  const toggle: MenuItem = { label: row.open ? "Fermer" : "Ouvrir", shortcut: "⏎", action: () => app.toggleNode(row.key) };
  switch (row.kind) {
    case "folder":
      return row.parent === null
        ? [toggle, { label: "Révéler dans le Finder" }, { type: "separator" }, { label: "Retirer la source", danger: true, action: () => app.removeSource(+row.key.slice(2)) }]
        : [toggle, { label: "Révéler dans le Finder" }];
    case "group":
      return [toggle, { type: "separator" }, { label: "Nouvelle collection", action: () => app.newCollection() }];
    default:
      return [
        toggle,
        { label: "Renommer", action: () => app.setRenamingKey(row.key) },
        { type: "separator" },
        { label: "Supprimer la collection", danger: true, action: () => app.deleteCollection(row.key) },
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
    <div class="cr-panel cr-root" data-density={app.density()}>
      <header class="cr-titlebar" data-tauri-drag-region>
        <span class="cr-titlebar__title" data-tauri-drag-region>
          Crate
        </span>
        <IconButton
          icon="settings"
          label="Réglages (⌘,)"
          active={app.view() === "settings"}
          onClick={() => app.setView(app.view() === "settings" ? "browser" : "settings")}
        />
      </header>

      <Switch>
        <Match when={app.empty()}>
          <EmptyState
            variant="drop"
            title="Glissez un dossier ici"
            body={
              <>
                Crate indexe vos samples sans les déplacer.
                <br />
                ou <kbd class="cr-kbd">⌘O</kbd> pour choisir un dossier
              </>
            }
          />
        </Match>
        <Match when={app.view() === "settings"}>
          <SettingsView
            sources={app.sources()}
            theme={app.themePref()}
            density={app.density()}
            alwaysOnTop={app.alwaysOnTop()}
            autoPlay={app.autoPlay()}
            onBack={() => app.setView("browser")}
            onTheme={app.setTheme}
            onDensity={app.setDensity}
            onAlwaysOnTop={app.setAlwaysOnTop}
            onAutoPlay={app.setAutoPlay}
            onRemoveSource={app.removeSource}
          />
        </Match>
        <Match when={true}>
          <SearchField ref={props.searchRef} forceAc={props.forceAc && !app.tagging()} />
          <Show when={app.saving() !== null}>
            <SaveSearch value={app.saving()!} onSubmit={app.saveSearch} onCancel={() => app.setSaving(null)} />
          </Show>
          <Show when={app.scan()}>{(s) => <ScanStatus folder={s().folder} done={s().done} total={s().total} />}</Show>
          <Show
            when={app.visible().length}
            fallback={
              <EmptyState
                variant="noresults"
                title="Aucun résultat"
                body={<>Rien ne correspond à « {app.queryLine()} ».</>}
                hints={["kick dark", "#warm -#bright", "bpm:120-128 key:Am", "dur:<1s type:oneshot"]}
              />
            }
          >
            <Browser />
          </Show>
          <PreviewDrawer
            sample={app.current()}
            playing={app.playingId() !== null && app.playingId() === app.current()?.id}
            progress={app.progress()}
            themeKey={app.theme()}
            onTogglePlay={() => app.togglePlay()}
          />
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
          const row = app.rowByKey(m().rowKey);
          return row ? <ContextMenu x={m().x} y={m().y} items={menuFor(row)} onClose={() => app.setMenu(null)} /> : null;
        }}
      </Show>
    </div>
  );
}
