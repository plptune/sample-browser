// Réglages : remplacent l'arbre dans la même colonne (pas de fenêtre secondaire). Échap ou ‹ pour revenir.
import { For, Show, type JSX } from "solid-js";
import type { Source } from "../api";
import type { Density, ThemePref } from "../state/app";
import { IconButton } from "./IconButton";
import { Segmented } from "./Segmented";
import { Toggle } from "./Toggle";

function Row(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div class="cr-setting">
      <div class="cr-setting__text">
        <span class="cr-setting__label">{props.label}</span>
        <Show when={props.hint}>
          <span class="cr-setting__hint">{props.hint}</span>
        </Show>
      </div>
      {props.children}
    </div>
  );
}

export function SettingsView(props: {
  sources: Source[];
  theme: ThemePref;
  density: Density;
  alwaysOnTop: boolean;
  autoPlay: boolean;
  onBack?: () => void;
  onTheme?: (t: ThemePref) => void;
  onDensity?: (d: Density) => void;
  onAlwaysOnTop?: (v: boolean) => void;
  onAutoPlay?: (v: boolean) => void;
  onRemoveSource?: (id: number) => void;
  onAddSource?: () => void;
}) {
  return (
    <div class="cr-settings">
      <div class="cr-settings__head">
        <IconButton icon="back" label="Retour (échap)" onClick={() => props.onBack?.()} />
        <span class="cr-settings__title">Réglages</span>
      </div>

      <section class="cr-settings__section">
        <h3 class="cr-settings__h">Sources</h3>
        <For each={props.sources}>
          {(s) => (
            <div class="cr-source" data-offline={s.offline || undefined}>
              <div class="cr-setting__text">
                <span class="cr-setting__label">{s.name}</span>
                <span class="cr-setting__hint" title={s.path}>
                  {s.offline ? `hors ligne · ${s.path}` : s.path}
                </span>
              </div>
              <IconButton icon="close" label={`Retirer ${s.name}`} onClick={() => props.onRemoveSource?.(s.id)} />
            </div>
          )}
        </For>
        <button class="cr-settings__add" onClick={() => props.onAddSource?.()}>
          Ajouter un dossier…
        </button>
      </section>

      <section class="cr-settings__section">
        <h3 class="cr-settings__h">Apparence</h3>
        <Row label="Thème">
          <Segmented
            label="Thème"
            value={props.theme}
            options={[
              { value: "dark", label: "Sombre" },
              { value: "light", label: "Clair" },
              { value: "system", label: "Système" },
            ]}
            onChange={(v) => props.onTheme?.(v)}
          />
        </Row>
        <Row label="Densité">
          <Segmented
            label="Densité"
            value={props.density}
            options={[
              { value: "compact", label: "Compacte" },
              { value: "wave", label: "Waveform" },
            ]}
            onChange={(v) => props.onDensity?.(v)}
          />
        </Row>
      </section>

      <section class="cr-settings__section">
        <h3 class="cr-settings__h">Fenêtre et lecture</h3>
        <Row label="Toujours au premier plan" hint="Reste visible au-dessus du DAW">
          <Toggle label="Toujours au premier plan" checked={props.alwaysOnTop} onChange={(v) => props.onAlwaysOnTop?.(v)} />
        </Row>
        <Row label="Lecture auto" hint="Lit le sample dès qu'il est sélectionné">
          <Toggle label="Lecture auto" checked={props.autoPlay} onChange={(v) => props.onAutoPlay?.(v)} />
        </Row>
      </section>
    </div>
  );
}
