// Réglages : remplacent l'arbre dans la même colonne (pas de fenêtre secondaire), rangés en onglets. Échap ou ‹ pour revenir.
import { For, Show, createSignal, type JSX } from "solid-js";
import type { AnalysisStatus, Source } from "../api";
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
  { role: "accent", label: "Accent", hint: "Lecture, progression, focus" },
  { role: "primary", label: "Sélection", hint: "Ligne sélectionnée, onglet actif" },
  { role: "bg", label: "Fond", hint: "Les surfaces en découlent" },
];

export function SettingsView(props: {
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
  /** Analyse de fond en cours : « Analyse du tempo et de la tonalité · n / total ». */
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
        <IconButton icon="back" label="Retour (échap)" onClick={() => props.onBack?.()} />
        <span class="cr-settings__title">Réglages</span>
      </div>
      <div class="cr-settings__tabs">
        <Segmented
          label="Rubrique"
          value={tab()}
          options={[
            { value: "sources", label: "Sources" },
            { value: "appearance", label: "Apparence" },
            { value: "playback", label: "Lecture" },
            { value: "search", label: "Recherche" },
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
                    {s.offline ? `hors ligne · ${s.path}` : s.path}
                  </span>
                </div>
                <IconButton icon="close" label={`Retirer ${s.name}`} onClick={() => props.onRemoveSource?.(s.id)} />
              </div>
            )}
          </For>
          <Show when={props.analysis && props.analysis.done < props.analysis.total ? props.analysis : null}>
            {(a) => (
              <div class="cr-setting" role="status">
                <span class="cr-setting__hint cr-num">
                  Analyse du tempo et de la tonalité · {a().done.toLocaleString("fr-FR")} / {a().total.toLocaleString("fr-FR")}
                </span>
              </div>
            )}
          </Show>
          <button class="cr-settings__add" onClick={() => props.onAddSource?.()}>
            Ajouter un dossier…
          </button>
        </section>
      </Show>

      <Show when={tab() === "appearance"}>
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
          <Row label="Taille du texte">
            <Segmented
              label="Taille du texte"
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
          <h3 class="cr-settings__h">Couleurs du thème {props.theme === "light" ? "clair" : props.theme === "dark" ? "sombre" : "affiché"}</h3>
          <For each={COLOR_ROLES}>
            {(c) => (
              <Row label={c.label} hint={c.hint}>
                <div class="cr-color">
                  <Show when={props.customColors?.[c.role]}>
                    <IconButton icon="close" label={`Rétablir la couleur ${c.label.toLowerCase()}`} onClick={() => props.onColor?.(c.role, null)} />
                  </Show>
                  <input
                    class="cr-color__input"
                    type="color"
                    value={props.colors?.[c.role] ?? "#000000"}
                    aria-label={`Couleur ${c.label.toLowerCase()}`}
                    onInput={(e) => props.onColor?.(c.role, e.currentTarget.value)}
                  />
                </div>
              </Row>
            )}
          </For>
          <Show when={Object.keys(props.customColors ?? {}).length}>
            <button class="cr-settings__add" onClick={() => props.onResetColors?.()}>
              Rétablir toutes les couleurs
            </button>
          </Show>
        </section>
      </Show>

      <Show when={tab() === "search"}>
        <section class="cr-settings__section">
          <h3 class="cr-settings__h">Synonymes</h3>
          <div class="cr-setting">
            <span class="cr-setting__hint">Un mot d'une ligne trouve aussi les autres : « kick » trouve « bd ».</span>
          </div>
          <For each={groups()}>
            {(line, i) => (
              <div class="cr-setting">
                <input
                  class="cr-field cr-synonyms__field"
                  value={line}
                  placeholder={line ? undefined : "Nouveau groupe : hat, hh, hihat"}
                  spellcheck={false}
                  aria-label={line ? `Synonymes : ${line}` : "Nouveau groupe de synonymes"}
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
          <h3 class="cr-settings__h">Fenêtre et lecture</h3>
          <Row label="Toujours au premier plan" hint="Reste visible au-dessus du DAW">
            <Toggle label="Toujours au premier plan" checked={props.alwaysOnTop} onChange={(v) => props.onAlwaysOnTop?.(v)} />
          </Row>
          <Row label="Lecture auto" hint="Lit le sample dès qu'il est sélectionné">
            <Toggle label="Lecture auto" checked={props.autoPlay} onChange={(v) => props.onAutoPlay?.(v)} />
          </Row>
          <Row label="Boucle" hint="⌘L">
            <Toggle label="Boucle" checked={!!props.looping} onChange={(v) => props.onLooping?.(v)} />
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
          <Row label="Arrêter au glisser" hint="Quand un sample part vers le DAW">
            <Toggle label="Arrêter au glisser" checked={props.stopOnDrag ?? true} onChange={(v) => props.onStopOnDrag?.(v)} />
          </Row>
          <Row label="Arrêter en arrière-plan" hint="Quand une autre app passe devant">
            <Toggle label="Arrêter en arrière-plan" checked={props.stopOnBlur ?? true} onChange={(v) => props.onStopOnBlur?.(v)} />
          </Row>
        </section>
      </Show>
    </div>
  );
}
