// Planche des tokens : couleurs (sombre / clair), typographie, espacements et grille d'alignement.
import { For } from "solid-js";

const COLORS = [
  ["Surfaces", ["--cr-bg", "--cr-surface", "--cr-surface-raised", "--cr-hover", "--cr-selected", "--cr-selected-focus"]],
  ["Lignes", ["--cr-line", "--cr-line-soft"]],
  ["Texte", ["--cr-text-strong", "--cr-text", "--cr-text-2", "--cr-text-3", "--cr-text-disabled"]],
  ["Accent & système", ["--cr-accent", "--cr-accent-soft", "--cr-danger"]],
  ["Waveform", ["--cr-wave", "--cr-wave-played", "--cr-wave-mini"]],
] as const;

const TYPE = [
  ["--cr-fs-xs", "10 px · méta, en-têtes de colonne"],
  ["--cr-fs-sm", "11 px · lignes, items, sections"],
  ["--cr-fs-md", "12 px · recherche, titre du tiroir"],
  ["--cr-fs-lg", "13 px · états vides"],
] as const;

const SPACE = ["--cr-space-0", "--cr-space-1", "--cr-space-2", "--cr-space-3", "--cr-space-4", "--cr-space-6"];

const SIZES = [
  ["--cr-titlebar-h", "barre titre"],
  ["--cr-search-h", "champ de recherche"],
  ["--cr-row-h", "ligne de sample"],
  ["--cr-row-h-wave", "ligne avec waveform"],
  ["--cr-item-h", "item de sidebar"],
  ["--cr-header-h", "en-tête"],
] as const;

export function Tokens() {
  return (
    <>
      <h2>Couleurs</h2>
      <div class="gal-row">
        <For each={["dark", "light"] as const}>
          {(theme) => (
            <div class="gal-frame">
              <small>{theme === "dark" ? "Sombre" : "Clair"}</small>
              <div class="gal-surface cr-root tok-board" data-theme={theme}>
                <For each={COLORS}>
                  {([group, names]) => (
                    <div class="tok-group">
                      <div class="tok-title">{group}</div>
                      <For each={names}>
                        {(n) => (
                          <div class="tok-color">
                            <span class="tok-swatch" style={{ background: `var(${n})` }} />
                            <code>{n}</code>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      <h2>Typographie</h2>
      <div class="gal-surface cr-root tok-board" data-theme="dark">
        <For each={TYPE}>
          {([n, label]) => (
            <div class="tok-type">
              <span style={{ "font-size": `var(${n})`, color: "var(--cr-text-strong)" }}>Kick_Dusty_04 · 120 BPM · Am</span>
              <code>
                {n} — {label}
              </code>
            </div>
          )}
        </For>
      </div>

      <h2>Espacements · dimensions</h2>
      <div class="gal-row">
        <div class="gal-surface cr-root tok-board" data-theme="dark">
          <div class="tok-title">Grille de 4 px</div>
          <For each={SPACE}>
            {(n) => (
              <div class="tok-space">
                <span class="tok-bar" style={{ width: `var(${n})` }} />
                <code>{n}</code>
              </div>
            )}
          </For>
        </div>
        <div class="gal-surface cr-root tok-board" data-theme="dark">
          <div class="tok-title">Hauteurs fixes</div>
          <For each={SIZES}>
            {([n, label]) => (
              <div class="tok-space">
                <span class="tok-bar tok-bar--v" style={{ height: `var(${n})` }} />
                <code>
                  {n} — {label}
                </code>
              </div>
            )}
          </For>
        </div>
        <div class="gal-surface cr-root tok-board" data-theme="dark" style={{ width: "260px" }}>
          <div class="tok-title">Alignement (gutter 8 · slot 12 · indent 16)</div>
          <div class="tok-grid">
            <div class="tok-grid__lines" />
            <div class="cr-item" style={{ "--depth": 0 }}>
              <span class="cr-item__slot">▸</span>
              <span class="cr-item__label">Sources</span>
            </div>
            <div class="cr-item" style={{ "--depth": 1 }}>
              <span class="cr-item__slot">▸</span>
              <span class="cr-item__label">Drums</span>
            </div>
            <div class="cr-item" style={{ "--depth": 2 }}>
              <span class="cr-item__slot" />
              <span class="cr-item__label">Kicks</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
