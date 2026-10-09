import { Match, Show, Switch } from "solid-js";
import { app } from "../state/app";
import { Browser } from "./Browser";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { PreviewDrawer } from "./PreviewDrawer";
import { ScanStatus } from "./ScanStatus";
import { SearchField } from "./SearchField";

export function PanelShell(props: { searchRef?: (el: HTMLInputElement) => void; forceAc?: boolean }) {
  return (
    <div class="cr-panel cr-root" data-density={app.density()}>
      <header class="cr-titlebar">
        <span class="cr-titlebar__title">Crate</span>
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
        </Match>
      </Switch>
    </div>
  );
}
