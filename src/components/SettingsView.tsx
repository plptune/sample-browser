// Réglages : remplacent l'arbre dans la même colonne (pas de fenêtre secondaire), rangés en onglets. Échap ou ‹ pour revenir.
import { For, Show, createSignal, type JSX } from "solid-js";
import type { AnalysisStatus, Source } from "../api";
import type { DawShortcutConfig } from "../api/bindings";
import { KNOWN_DAWS, formatShortcut, shortcutFromEvent } from "../lib/shortcut";
import type { ColorRole, Density, FontSize, ThemePref } from "../state/app";
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

export type SettingsTab = "sources" | "appearance" | "playback" | "search";

/** Onglet ouvert : retenu le temps de la session (rouvrir les Réglages revient au même endroit). */
const [lastTab, setLastTab] = createSignal<SettingsTab>("sources");

const COLOR_ROLES: { role: ColorRole; label: string; hint: string }[] = [
  { role: "accent", label: "Accent", hint: "Playback, progress, focus" },
  { role: "primary", label: "Selection", hint: "Selected row, active tab" },
  { role: "bg", label: "Background", hint: "Surfaces follow it" },
];

/** Champ de capture : clic, puis le raccourci voulu (avec ⌘, ⌃, ⌥ ou ⇧). Échap annule. */
function ShortcutField(props: { value: string; onChange: (v: string) => void }) {
  const [capturing, setCapturing] = createSignal(false);
  return (
    <button
      class="cr-shortcut"
      data-capturing={capturing() || undefined}
      aria-label={capturing() ? "Type the shortcut" : `Shortcut: ${formatShortcut(props.value)}`}
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={(e) => {
        if (!capturing()) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") return setCapturing(false);
        const s = shortcutFromEvent(e);
        if (!s) return;
        props.onChange(s);
        setCapturing(false);
      }}
    >
      {capturing() ? "Type the shortcut…" : formatShortcut(props.value)}
    </button>
  );
}

export function SettingsView(props: {
  /** Recherche depuis le DAW : raccourci pris seulement quand un DAW de la liste est devant (macOS). */
  dawShortcut?: DawShortcutConfig;
  onDawShortcut?: (c: DawShortcutConfig) => void;
  /** Onglet affiché à l'ouverture (stories, tests) ; sinon le dernier ouvert. */
  initialTab?: SettingsTab;
  fontSize?: FontSize;
  onFontSize?: (f: FontSize) => void;
  /** Couleurs de base du thème affiché : valeurs en vigueur, et celles qui ont été changées. */
  colors?: Record<ColorRole, string>;
  customColors?: Partial<Record<ColorRole, string>>;
  onColor?: (role: ColorRole, value: string | null) => void;
  onResetColors?: () => void;
  sources: Source[];
  /** Analyse de fond en cours : « Analyzing tempo and key · n / total ». */
  analysis?: AnalysisStatus | null;
  theme: ThemePref;
  density: Density;
  alwaysOnTop: boolean;
  autoPlay: boolean;
  looping?: boolean;
  volume?: number; // 0..1
  stopOnDrag?: boolean;
  stopOnBlur?: boolean;
  onLooping?: (v: boolean) => void;
  onVolume?: (v: number) => void;
  onStopOnDrag?: (v: boolean) => void;
  onStopOnBlur?: (v: boolean) => void;
  onBack?: () => void;
  onTheme?: (t: ThemePref) => void;
  onDensity?: (d: Density) => void;
  onAlwaysOnTop?: (v: boolean) => void;
  onAutoPlay?: (v: boolean) => void;
  onRemoveSource?: (id: number) => void;
  onAddSource?: () => void;
  /** Groupes de synonymes de la recherche (« kick, bd, bassdrum »). */
  synonyms?: string[][];
  onSynonyms?: (groups: string[][]) => void;
}) {
  // Une ligne par groupe ; la dernière, vide, en ajoute un. Valider (⏎ ou sortie du champ) enregistre tout.
  const groups = () => [...(props.synonyms ?? []).map((g) => g.join(", ")), ""];
  const commit = (index: number, value: string) => {
    const lines = groups();
    lines[index] = value;
    props.onSynonyms?.(lines.map((l) => l.split(",").map((w) => w.trim()).filter(Boolean)));
  };
  if (props.initialTab) setLastTab(props.initialTab);
  const tab = lastTab;
  return (
    <div class="cr-settings">
      <div class="cr-settings__head">
        <IconButton icon="back" label="Back (Esc)" onClick={() => props.onBack?.()} />
        <span class="cr-settings__title">Settings</span>
      </div>
      <div class="cr-settings__tabs">
        <Segmented
          label="Section"
          value={tab()}
          options={[
            { value: "sources", label: "Sources" },
            { value: "appearance", label: "Appearance" },
            { value: "playback", label: "Playback" },
            { value: "search", label: "Search" },
          ]}
          onChange={setLastTab}
        />
      </div>

      <Show when={tab() === "sources"}>
        <section class="cr-settings__section">
          <h3 class="cr-settings__h">Sources</h3>
          <For each={props.sources}>
            {(s) => (
              <div class="cr-source" data-offline={s.offline || undefined}>
                <div class="cr-setting__text">
                  <span class="cr-setting__label">{s.name}</span>
                  <span class="cr-setting__hint" title={s.path}>
                    {s.offline ? `offline · ${s.path}` : s.path}
                  </span>
                </div>
                <IconButton icon="close" label={`Remove ${s.name}`} onClick={() => props.onRemoveSource?.(s.id)} />
              </div>
            )}
          </For>
          <Show when={props.analysis && props.analysis.done < props.analysis.total ? props.analysis : null}>
            {(a) => (
              <div class="cr-setting" role="status">
                <span class="cr-setting__hint cr-num">
                  Analyzing tempo and key · {a().done.toLocaleString("en-US")} / {a().total.toLocaleString("en-US")}
                </span>
              </div>
            )}
          </Show>
          <button class="cr-settings__add" onClick={() => props.onAddSource?.()}>
            Add a folder…
          </button>
        </section>
      </Show>

      <Show when={tab() === "appearance"}>
        <section class="cr-settings__section">
          <h3 class="cr-settings__h">Appearance</h3>
          <Row label="Theme">
            <Segmented
              label="Theme"
              value={props.theme}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "System" },
              ]}
              onChange={(v) => props.onTheme?.(v)}
            />
          </Row>
          <Row label="Density">
            <Segmented
              label="Density"
              value={props.density}
              options={[
                { value: "compact", label: "Compact" },
                { value: "wave", label: "Waveform" },
              ]}
              onChange={(v) => props.onDensity?.(v)}
            />
          </Row>
          <Row label="Text size">
            <Segmented
              label="Text size"
              value={props.fontSize ?? "base"}
              options={[
                { value: "sm", label: "S" },
                { value: "base", label: "M" },
                { value: "lg", label: "L" },
              ]}
              onChange={(v) => props.onFontSize?.(v)}
            />
          </Row>
        </section>

        <section class="cr-settings__section">
          <h3 class="cr-settings__h">{props.theme === "light" ? "Light" : props.theme === "dark" ? "Dark" : "Current"} theme colors</h3>
          <For each={COLOR_ROLES}>
            {(c) => (
              <Row label={c.label} hint={c.hint}>
                <div class="cr-color">
                  <Show when={props.customColors?.[c.role]}>
                    <IconButton icon="close" label={`Reset ${c.label.toLowerCase()} color`} onClick={() => props.onColor?.(c.role, null)} />
                  </Show>
                  <input
                    class="cr-color__input"
                    type="color"
                    value={props.colors?.[c.role] ?? "#000000"}
                    aria-label={`${c.label} color`}
                    onInput={(e) => props.onColor?.(c.role, e.currentTarget.value)}
                  />
                </div>
              </Row>
            )}
          </For>
          <Show when={Object.keys(props.customColors ?? {}).length}>
            <button class="cr-settings__add" onClick={() => props.onResetColors?.()}>
              Reset all colors
            </button>
          </Show>
        </section>
      </Show>

      <Show when={tab() === "search"}>
        <section class="cr-settings__section">
          <h3 class="cr-settings__h">Synonyms</h3>
          <div class="cr-setting">
            <span class="cr-setting__hint">A word on a line also finds the others: “kick” finds “bd”.</span>
          </div>
          <For each={groups()}>
            {(line, i) => (
              <div class="cr-setting">
                <input
                  class="cr-field cr-synonyms__field"
                  value={line}
                  placeholder={line ? undefined : "New group: hat, hh, hihat"}
                  spellcheck={false}
                  aria-label={line ? `Synonyms: ${line}` : "New synonym group"}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onChange={(e) => commit(i(), e.currentTarget.value)}
                />
              </div>
            )}
          </For>
        </section>
      </Show>

      <Show when={tab() === "playback"}>
        <section class="cr-settings__section">
          <h3 class="cr-settings__h">Window and playback</h3>
          <Row label="Always on top" hint="Stays visible above the DAW">
            <Toggle label="Always on top" checked={props.alwaysOnTop} onChange={(v) => props.onAlwaysOnTop?.(v)} />
          </Row>
          <Row label="Autoplay" hint="Plays a sample as soon as it's selected">
            <Toggle label="Autoplay" checked={props.autoPlay} onChange={(v) => props.onAutoPlay?.(v)} />
          </Row>
          <Row label="Loop" hint="⌘L">
            <Toggle label="Loop" checked={!!props.looping} onChange={(v) => props.onLooping?.(v)} />
          </Row>
          <Row label="Volume">
            <input
              class="cr-range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.volume ?? 1}
              aria-label="Volume"
              onInput={(e) => props.onVolume?.(+e.currentTarget.value)}
            />
          </Row>
          <Row label="Stop on drag" hint="When a sample is dragged to the DAW">
            <Toggle label="Stop on drag" checked={props.stopOnDrag ?? true} onChange={(v) => props.onStopOnDrag?.(v)} />
          </Row>
          <Row label="Stop in background" hint="When another app comes to the front">
            <Toggle label="Stop in background" checked={props.stopOnBlur ?? true} onChange={(v) => props.onStopOnBlur?.(v)} />
          </Row>
        </section>

        <Show when={props.dawShortcut}>
          {(d) => {
            const set = (patch: Partial<DawShortcutConfig>) => props.onDawShortcut?.({ ...d(), ...patch });
            return (
              <section class="cr-settings__section">
                <h3 class="cr-settings__h">From the DAW</h3>
                <Row label="Search from the DAW" hint="In the DAW, the shortcut opens Crate's search; Esc goes back">
                  <Toggle label="Search from the DAW" checked={d().enabled} onChange={(v) => set({ enabled: v })} />
                </Row>
                <Row label="Shortcut" hint="Only taken while one of these DAWs is in front">
                  <ShortcutField value={d().shortcut} onChange={(v) => set({ shortcut: v })} />
                </Row>
                <For each={KNOWN_DAWS}>
                  {(daw) => (
                    <Row label={daw.name}>
                      <Toggle
                        label={daw.name}
                        checked={d().apps.includes(daw.id)}
                        onChange={(v) => set({ apps: v ? [...d().apps, daw.id] : d().apps.filter((a) => a !== daw.id) })}
                      />
                    </Row>
                  )}
                </For>
              </section>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
