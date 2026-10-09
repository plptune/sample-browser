import { Match, Show, Switch } from "solid-js";
import { app } from "../state/app";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { PreviewDrawer } from "./PreviewDrawer";
import { SampleList } from "./SampleList";
import { ScanStatus } from "./ScanStatus";
import { SearchField } from "./SearchField";
import { Sidebar } from "./Sidebar";

export function PanelShell(props: { searchRef?: (el: HTMLInputElement) => void; forceAc?: boolean }) {
  const current = () => app.byId(app.cursor());
  return (
    <div class="cr-panel cr-root" data-density={app.density()}>
      <header class="cr-titlebar">
        <span class="cr-titlebar__title">Crate</span>
        <IconButton
          icon="sidebar"
          label="Afficher / masquer la navigation"
          active={!app.sidebarCollapsed()}
          onClick={() => app.setSidebarCollapsed(!app.sidebarCollapsed())}
        />
        <IconButton icon="settings" label="Réglages" />
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
        <Match when={!app.empty()}>
          <SearchField ref={props.searchRef} forceAc={props.forceAc} />
          <Show when={app.scan()}>{(s) => <ScanStatus folder={s().folder} done={s().done} total={s().total} />}</Show>
          <Show when={!app.sidebarCollapsed()}>
            <Sidebar />
          </Show>
          <Show
            when={app.visible().length || app.scan()}
            fallback={
              <EmptyState
                variant="noresults"
                title="Aucun résultat"
                body={app.queryLine() ? <>Rien ne correspond à « {app.queryLine()} ».</> : "Ce dossier est vide."}
                hints={["kick dark", "#warm -#bright", "bpm:120-128 key:Am", "dur:<1s type:oneshot"]}
              />
            }
          >
            <SampleList />
          </Show>
          <PreviewDrawer
            sample={current()}
            selectedCount={app.selection().length}
            playing={app.playingId() !== null && app.playingId() === app.cursor()}
            progress={app.progress()}
            autoPlay={app.autoPlay()}
            themeKey={app.theme()}
            onTogglePlay={() => app.togglePlay()}
            onToggleAuto={() => app.setAutoPlay(!app.autoPlay())}
          />
        </Match>
      </Switch>
    </div>
  );
}
