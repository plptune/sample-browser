// « Créer un vrai dossier » : copie le contenu d'un dossier virtuel (ou d'une collection, à plat) vers un nouveau
// dossier sur le disque. Les fichiers sources ne sont jamais déplacés ni modifiés. Remplace l'arbre dans la colonne.
import { Match, Show, Switch } from "solid-js";
import type { CommitOptions, CommitPlan, CommitResult } from "../api";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Toggle } from "./Toggle";

const fmt = new Intl.NumberFormat("en-US");

export function formatBytes(n: number): string {
  if (n < 1e6) return `${fmt.format(Math.max(1, Math.round(n / 1e3)))} KB`;
  if (n < 1e9) return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n / 1e6)} MB`;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n / 1e9)} GB`;
}

const plural = (n: number, one: string, many: string) => `${fmt.format(n)} ${n > 1 ? many : one}`;

export function CommitView(props: {
  name: string;
  flat: boolean;
  destination: string;
  options: CommitOptions;
  plan: CommitPlan | null;
  status: "idle" | "running" | "done";
  progress: number;
  result: CommitResult | null;
  error?: string | null;
  onBack?: () => void;
  onDestination?: (v: string) => void;
  onOptions?: (o: CommitOptions) => void;
  onChoose?: () => void;
  onCommit?: () => void;
  onReveal?: () => void;
}) {
  const p = () => props.plan;
  return (
    <div class="cr-settings cr-commit">
      <div class="cr-settings__head">
        <IconButton icon="back" label="Back (Esc)" disabled={props.status === "running"} onClick={() => props.onBack?.()} />
        <span class="cr-settings__title">Create a real folder</span>
      </div>

      <section class="cr-settings__section">
        <h3 class="cr-settings__h">{props.flat ? "Collection" : "Virtual folder"}</h3>
        <div class="cr-setting">
          <div class="cr-setting__text">
            <span class="cr-setting__label">{props.name}</span>
            <span class="cr-setting__hint cr-num">
              <Show when={p()} fallback="Calculating…">
                {plural(p()!.files, "file", "files")}
                <Show when={p()!.folders}> · {plural(p()!.folders, "subfolder", "subfolders")}</Show> · {formatBytes(p()!.bytes)}
              </Show>
            </span>
            <Show when={p()?.missing}>
              <span class="cr-setting__hint cr-commit__warn">{plural(p()!.missing, "missing file will be skipped", "missing files will be skipped")}</span>
            </Show>
          </div>
        </div>
      </section>

      <Switch>
        <Match when={props.status === "idle"}>
          <section class="cr-settings__section">
            <h3 class="cr-settings__h">Destination</h3>
            <div class="cr-setting cr-commit__dest">
              <input
                class="cr-field"
                value={props.destination}
                spellcheck={false}
                aria-label="Folder to create"
                onInput={(e) => props.onDestination?.(e.currentTarget.value)}
              />
              <Button onClick={() => props.onChoose?.()}>Choose…</Button>
            </div>
            <div class="cr-setting">
              <div class="cr-setting__text">
                <span class="cr-setting__label">Keep folder structure</span>
                <span class="cr-setting__hint">{props.flat ? "A collection is always flat" : "Recreates the virtual subfolders"}</span>
              </div>
              <Toggle
                label="Keep folder structure"
                checked={props.options.keepHierarchy}
                onChange={(v) => !props.flat && props.onOptions?.({ ...props.options, keepHierarchy: v })}
              />
            </div>
            <div class="cr-setting">
              <div class="cr-setting__text">
                <span class="cr-setting__label">Add to sources</span>
                <span class="cr-setting__hint">The new folder appears in Library</span>
              </div>
              <Toggle
                label="Add to sources"
                checked={props.options.addAsSource}
                onChange={(v) => props.onOptions?.({ ...props.options, addAsSource: v })}
              />
            </div>
          </section>
          <Show when={props.error}>
            <div class="cr-setting">
              <span class="cr-setting__hint cr-commit__warn" role="alert">
                {props.error}
              </span>
            </div>
          </Show>
          <div class="cr-commit__actions">
            <span class="cr-setting__hint">Copie : les fichiers d'origine ne bougent pas.</span>
            <Button variant="primary" disabled={!p() || !p()!.files || !props.destination.trim()} onClick={() => props.onCommit?.()}>
              Create folder
            </Button>
          </div>
        </Match>
        <Match when={props.status === "running"}>
          <section class="cr-settings__section">
            <div class="cr-setting">
              <div class="cr-setting__text">
                <span class="cr-setting__label">Copying…</span>
                <span class="cr-setting__hint cr-num">
                  {fmt.format(Math.round((p()?.files ?? 0) * props.progress))} / {fmt.format(p()?.files ?? 0)} · {props.destination}
                </span>
              </div>
            </div>
            <div class="cr-commit__bar">
              <div class="cr-scan__fill" style={{ width: `${props.progress * 100}%` }} />
            </div>
          </section>
        </Match>
        <Match when={props.status === "done" && props.result}>
          {(r) => (
            <>
              <section class="cr-settings__section">
                <div class="cr-setting">
                  <div class="cr-setting__text">
                    <span class="cr-setting__label">{plural(r().copied, "file copied", "files copied")}</span>
                    <span class="cr-setting__hint" title={r().destination}>
                      {r().destination}
                    </span>
                    <Show when={r().skipped}>
                      <span class="cr-setting__hint cr-commit__warn">{plural(r().skipped, "missing file skipped", "missing files skipped")}</span>
                    </Show>
                  </div>
                </div>
              </section>
              <div class="cr-commit__actions">
                <Button onClick={() => props.onReveal?.()}>Open in Finder</Button>
                <Button variant="primary" onClick={() => props.onBack?.()}>
                  Done
                </Button>
              </div>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
