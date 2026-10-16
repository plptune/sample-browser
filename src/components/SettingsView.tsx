// Réglages : remplacent l'arbre dans la même colonne (pas de fenêtre secondaire), rangés en onglets. Échap ou ‹ pour revenir.
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { AnalysisStatus, BitwigState, Source } from "../api";
import type { DawShortcutConfig } from "../api/bindings";
import { KNOWN_DAWS, formatShortcut, heldModifiers, shortcutFromEvent } from "../lib/shortcut";
import type { ColorRole, Density, FontSize, SpliceSyncState, ThemePref } from "../state/app";
import { Button } from "./Button";
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

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, word: string) => `${n(x)} ${word}${x === 1 ? "" : "s"}`;

/** Ligne d'état du script de Crate dans Bitwig. */
function bitwigStatus(s: BitwigState | null | undefined): string {
  if (s?.error) return s.error;
  if (s?.connected) return "Bitwig connected";
  return "Waiting for Bitwig — add the Crate controller in Bitwig › Settings › Controllers";
}

/** Ligne d'état de la synchronisation Splice. */
function spliceStatus(s: SpliceSyncState): string {
  switch (s.status) {
    case "running":
      return "Reading the Splice library…";
    case "done":
      return `${n(s.report.matched)} of ${plural(s.report.spliceSamples, "Splice sample")} found · ${plural(s.report.added, "tag")} added`;
    case "cleared":
      return `${plural(s.removed, "Splice tag")} removed`;
    case "error":
      return s.error;
  }
}

export type SettingsTab = "sources" | "appearance" | "playback" | "search";

/** Onglet ouvert : retenu le temps de la session (rouvrir les Réglages revient au même endroit). */
const [lastTab, setLastTab] = createSignal<SettingsTab>("sources");

const COLOR_ROLES: { role: ColorRole; label: string; hint: string }[] = [
  { role: "accent", label: "Accent", hint: "Playback, progress, focus" },
  { role: "bg", label: "Background", hint: "Surfaces follow it" },
];

/** Raccourci actuel ; un clic ouvre la fenêtre de capture. */
function ShortcutField(props: { value: string; onChange: (v: string) => void; onCapture?: (on: boolean) => void }) {
  const [capturing, setCapturing] = createSignal(false);
  const close = () => {
    setCapturing(false);
    props.onCapture?.(false);
  };
  return (
    <>
      <button
        class="cr-shortcut"
        data-capturing={capturing() || undefined}
        aria-label={`Shortcut: ${formatShortcut(props.value)}`}
        onClick={() => {
          setCapturing(true);
          props.onCapture?.(true);
        }}
      >
        {formatShortcut(props.value)}
      </button>
      <Show when={capturing()}>
        <ShortcutDialog
          onAccept={(s) => {
            props.onChange(s);
            close();
          }}
          onCancel={close}
        />
      </Show>
    </>
  );
}

/**
 * Capture d'un raccourci : les touches sont lues sur toute la fenêtre (un bouton cliqué n'a pas le focus clavier dans
 * WebKit), le raccourci tapé s'affiche, et rien n'est changé avant « Accept » (ou ⏎). Échap ou « Cancel » annule.
 * Un raccourci doit avoir ⌘, ⌃, ⌥ ou ⇧ : une lettre seule serait volée au DAW.
 */
function ShortcutDialog(props: { onAccept: (s: string) => void; onCancel: () => void }) {
  const [pending, setPending] = createSignal<string | null>(null);
  const [held, setHeld] = createSignal("");
  const [needsModifier, setNeedsModifier] = createSignal(false);
  const onKey = (e: KeyboardEvent) => {
    // Rien d'autre ne réagit pendant la capture (raccourcis de l'app, champs).
    e.preventDefault();
    e.stopImmediatePropagation();
    setHeld(heldModifiers(e));
    if (e.type === "keyup" || e.repeat) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (plain && e.key === "Escape") return props.onCancel();
    if (plain && e.key === "Enter") {
      const p = pending();
      if (p) props.onAccept(p);
      return;
    }
    const s = shortcutFromEvent(e);
    if (s) {
      setPending(s);
      setNeedsModifier(false);
    } else if (!/^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/.test(e.code)) setNeedsModifier(true);
  };
  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
  });
  const shown = () => {
    const p = pending();
    if (held() && (!p || !formatShortcut(p).startsWith(held()))) return `${held()}…`;
    return p ? formatShortcut(p) : "…";
  };
  return (
    <div class="cr-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div class="cr-dialog" role="dialog" aria-modal="true" aria-label="New shortcut">
        <div class="cr-dialog__title">Press the new shortcut</div>
        <kbd class="cr-dialog__keys" data-empty={!pending() || undefined} aria-live="polite">
          {shown()}
        </kbd>
        <div class="cr-dialog__hint" data-warn={needsModifier() || undefined}>
          {needsModifier() ? "Add ⌘, ⌃, ⌥ or ⇧" : "Taken only while one of your DAWs is in front"}
        </div>
        <div class="cr-dialog__actions">
          <Button onClick={() => props.onCancel()}>Cancel</Button>
          <Button variant="primary" disabled={!pending()} onClick={() => props.onAccept(pending()!)}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SettingsView(props: {
  /** Recherche depuis le DAW : raccourci pris seulement quand un DAW de la liste est devant (macOS). */
  dawShortcut?: DawShortcutConfig;
  onDawShortcut?: (c: DawShortcutConfig) => void;
  /** Capture d'un raccourci ouverte (vrai) ou fermée : le raccourci global est mis en pause pendant ce temps. */
  onShortcutCapture?: (on: boolean) => void;
  /** Autorisation Accessibilité (redimensionner le DAW avec Crate) : faux affiche le lien vers les Réglages Système. */
  accessibility?: boolean | null;
  onRequestAccessibility?: () => void;
  onOpenAccessibility?: () => void;
  /** « Space plays Bitwig » : état du script dans Bitwig, résultat de sa copie, bouton « Install Bitwig script ». */
  bitwig?: BitwigState | null;
  bitwigScript?: { path: string } | { error: string } | null;
  onInstallBitwig?: () => void;
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
  /** Tags repris de la base locale de Splice : état de la dernière synchronisation, synchroniser, tout retirer. */
  spliceSync?: SpliceSyncState | null;
  onSyncSplice?: () => void;
  onClearSplice?: () => void;
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
        <section class="cr-settings__section">
          <h3 class="cr-settings__h">Splice</h3>
          <div class="cr-setting">
            <span class="cr-setting__hint" data-wrap>
              Adds the tags of your Splice downloads, dimmed. A tag you remove stays removed.
            </span>
          </div>
          <Show when={props.spliceSync}>
            {(s) => (
              <div class="cr-setting" role={s().status === "error" ? "alert" : "status"}>
                <span class="cr-setting__hint cr-num" data-wrap data-error={s().status === "error" || undefined}>
                  {spliceStatus(s())}
                </span>
              </div>
            )}
          </Show>
          <button
            class="cr-settings__add"
            disabled={props.spliceSync?.status === "running"}
            onClick={() => props.onSyncSplice?.()}
          >
            {props.spliceSync?.status === "running" ? "Syncing…" : "Sync Splice tags"}
          </button>
          <button
            class="cr-settings__add"
            disabled={props.spliceSync?.status === "running"}
            onClick={() => props.onClearSplice?.()}
          >
            Remove Splice tags
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
                <Row label="Keep the DAW in front" hint="Plug-in windows stay open while you use Crate">
                  <Toggle label="Keep the DAW in front" checked={d().keepDawActive ?? true} onChange={(v) => set({ keepDawActive: v })} />
                </Row>
                <Row label="Resize the DAW with Crate" hint="Drag the edge between them: one grows, the other shrinks">
                  <Toggle
                    label="Resize the DAW with Crate"
                    checked={d().resizeTogether ?? false}
                    onChange={(v) => {
                      set({ resizeTogether: v });
                      if (v) props.onRequestAccessibility?.();
                    }}
                  />
                </Row>
                <Show when={d().resizeTogether && props.accessibility === false}>
                  <Row label="Accessibility" hint="Allow Crate in Privacy & Security › Accessibility">
                    <button class="cr-settings__add" onClick={() => props.onOpenAccessibility?.()}>
                      Open settings
                    </button>
                  </Row>
                </Show>
                <Row label="Space plays Bitwig" hint="Space starts and stops Bitwig's transport and stops the preview">
                  <Toggle label="Space plays Bitwig" checked={d().spaceToDaw ?? false} onChange={(v) => set({ spaceToDaw: v })} />
                </Row>
                <Show when={d().spaceToDaw}>
                  <div class="cr-setting" role={props.bitwig?.error ? "alert" : "status"}>
                    <span class="cr-setting__hint" data-wrap data-error={props.bitwig?.error ? true : undefined}>
                      {bitwigStatus(props.bitwig)}
                    </span>
                  </div>
                  <button class="cr-settings__add" onClick={() => props.onInstallBitwig?.()}>
                    Install Bitwig script
                  </button>
                  <Show when={props.bitwigScript}>
                    {(r) => (
                      <div class="cr-setting" role={"error" in r() ? "alert" : "status"}>
                        <span class="cr-setting__hint" data-wrap data-error={"error" in r() || undefined}>
                          {"error" in r() ? (r() as { error: string }).error : `Installed in ${(r() as { path: string }).path}`}
                        </span>
                      </div>
                    )}
                  </Show>
                </Show>
                <Row label="Search from the DAW" hint="In the DAW, the shortcut opens Crate's search; Esc goes back">
                  <Toggle label="Search from the DAW" checked={d().enabled} onChange={(v) => set({ enabled: v })} />
                </Row>
                <Row label="Shortcut" hint="Only taken while one of these DAWs is in front">
                  <ShortcutField value={d().shortcut} onChange={(v) => set({ shortcut: v })} onCapture={props.onShortcutCapture} />
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
