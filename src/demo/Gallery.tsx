// Galerie : chaque composant dans chacun de ses états, sombre / clair, à 260 et 380 px.
import { For, type JSX } from "solid-js";
import { Autocomplete } from "../components/Autocomplete";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/IconButton";
import { PreviewDrawer } from "../components/PreviewDrawer";
import { QueryChip } from "../components/QueryChip";
import { SampleRow } from "../components/SampleRow";
import { ScanStatus } from "../components/ScanStatus";
import { SidebarItem } from "../components/SidebarItem";
import { TagPill } from "../components/TagPill";
import { SAMPLES } from "../mock/generate";
import { Tokens } from "./Tokens";

const VARIANTS = [
  { theme: "dark", w: 260 },
  { theme: "dark", w: 380 },
  { theme: "light", w: 260 },
  { theme: "light", w: 380 },
] as const;

const find = (p: string, n = 0) => SAMPLES.filter((s) => s.name.startsWith(p))[n];
const kick = { ...find("Kick", 3), missing: false };
const kick2 = { ...find("Kick", 5), missing: false };
const loop = { ...find("Keys_Loop", 2), missing: false };
const missing = { ...find("Clap", 1), missing: true };

function Frames(props: { render: (theme: string) => JSX.Element }) {
  return (
    <div class="gal-row">
      <For each={VARIANTS}>
        {(v) => (
          <div class="gal-frame">
            <small>
              {v.theme === "dark" ? "Sombre" : "Clair"} · {v.w}px
            </small>
            <div class="gal-surface cr-root" data-theme={v.theme} style={{ width: `${v.w}px` }}>
              <div class="cr-panel" style={{ height: "auto" }}>
                {props.render(v.theme)}
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

const State = (props: { label: string; children: JSX.Element }) => (
  <>
    <div class="gal-state">{props.label}</div>
    {props.children}
  </>
);

function StaticSearch(props: { chips?: string[]; text?: string; focused?: boolean; placeholder?: boolean }) {
  return (
    <div class="cr-panel__search" style={{ "padding-top": "var(--cr-space-2)" }}>
      <div class="cr-search" data-focused={props.focused || undefined}>
        <Icon name="search" />
        <div class="cr-search__chips">
          <For each={props.chips}>{(c) => <QueryChip raw={c} />}</For>
          <input
            class="cr-search__input"
            value={props.text ?? ""}
            placeholder={props.placeholder ? "Rechercher" : ""}
            readOnly
          />
        </div>
        {props.chips?.length ? <IconButton icon="close" label="Effacer" /> : null}
      </div>
    </div>
  );
}

export function Gallery() {
  return (
    <div class="gal">
      <h1>Crate — design system</h1>
      <a href="#" style={{ color: "#888" }}>
        ← Prototype
      </a>

      <Tokens />

      <h2>IconButton</h2>
      <Frames
        render={() => (
          <div class="gal-pad">
            <IconButton icon="play" label="défaut" />
            <IconButton icon="stop" label="actif" active accent />
            <IconButton icon="loop" label="actif" active />
            <IconButton icon="settings" label="défaut" />
            <IconButton icon="sidebar" label="désactivé" disabled />
            <small style={{ color: "var(--cr-text-3)" }}>défaut · actif accent · actif · désactivé</small>
          </div>
        )}
      />

      <h2>SearchField · QueryChip</h2>
      <Frames
        render={() => (
          <>
            <State label="vide">
              <StaticSearch placeholder />
            </State>
            <State label="focus + texte">
              <StaticSearch focused text="kick dus" />
            </State>
            <State label="chips (tag, filtre, exclusion, en édition)">
              <StaticSearch focused chips={["#warm", "bpm:120-128", "-#bright"]} text="kick" />
            </State>
            <div class="gal-pad">
              <QueryChip raw="#warm" />
              <QueryChip raw="key:Am" />
              <QueryChip raw="dur:<1s" />
              <QueryChip raw="-loop" />
              <QueryChip raw="type:loop" pending />
            </div>
          </>
        )}
      />

      <h2>Autocomplete</h2>
      <Frames
        render={() => (
          <div style={{ position: "relative", height: "120px" }}>
            <Autocomplete
              items={[
                { label: "#warm", count: 84 },
                { label: "#wide", count: 61 },
                { label: "#lofi", count: 57 },
                { label: "#tape", count: 40 },
              ]}
              active={1}
              onPick={() => {}}
            />
          </div>
        )}
      />

      <h2>ScanStatus</h2>
      <Frames render={() => <ScanStatus folder="Samples" done={1240} total={3100} />} />

      <h2>SidebarItem</h2>
      <Frames
        render={() => (
          <div class="cr-sidebar" style={{ "max-height": "none" }}>
            <button class="cr-section__header">
              <svg class="cr-chevron" data-open viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M4.5 2.8 7.7 6 4.5 9.2" />
              </svg>
              <span class="cr-section__title">Section ouverte</span>
            </button>
            <SidebarItem label="Défaut" />
            <SidebarItem label="Sélectionné" selected />
            <SidebarItem label="Collection manuelle" mark="manual" />
            <SidebarItem label="Collection smart" mark="smart" />
            <SidebarItem label="Cible de dépôt" mark="manual" dropTarget />
            <SidebarItem label="Renommage" mark="manual" renaming />
            <SidebarItem label="Dossier replié" expandable />
            <SidebarItem label="Dossier ouvert" expandable open />
            <SidebarItem label="Niveau 2" expandable open depth={1} />
            <SidebarItem label="Niveau 3" depth={2} />
            <SidebarItem label="Source déconnectée" expandable offline />
          </div>
        )}
      />

      <h2>SampleRow</h2>
      <Frames
        render={(theme) => (
          <>
            <State label="défaut · sélection (liste non focus)">
              <div class="cr-list">
                <SampleRow sample={kick} />
                <SampleRow sample={kick2} />
                <SampleRow sample={loop} selected />
              </div>
            </State>
            <State label="liste focus : sélection · lecture · drag · introuvable">
              <div class="cr-list" data-focused>
                <SampleRow sample={kick} selected />
                <SampleRow sample={loop} playing progress={0.4} />
                <SampleRow sample={kick2} dragging />
                <SampleRow sample={missing} />
              </div>
            </State>
            <State label="mode waveform (36 px)">
              <div class="cr-list" data-focused>
                <SampleRow sample={kick} wave themeKey={theme} />
                <SampleRow sample={loop} wave selected playing progress={0.4} themeKey={theme} />
              </div>
            </State>
          </>
        )}
      />

      <h2>PreviewDrawer</h2>
      <Frames
        render={(theme) => (
          <>
            <State label="arrêt">
              <PreviewDrawer sample={kick} selectedCount={1} playing={false} progress={0} autoPlay={false} themeKey={theme} />
            </State>
            <State label="lecture 40 % · auto-play">
              <PreviewDrawer sample={loop} selectedCount={1} playing progress={0.4} autoPlay themeKey={theme} />
            </State>
            <State label="multi-sélection">
              <PreviewDrawer sample={loop} selectedCount={4} playing={false} progress={0} autoPlay={false} />
            </State>
          </>
        )}
      />

      <h2>TagPill</h2>
      <Frames
        render={() => (
          <div class="gal-pad">
            <TagPill name="warm" />
            <TagPill name="lofi" active />
            <TagPill name="" variant="add" />
          </div>
        )}
      />

      <h2>EmptyState</h2>
      <Frames
        render={() => (
          <>
            <State label="premier lancement">
              <EmptyState variant="drop" title="Glissez un dossier ici" body="Crate indexe vos samples sans les déplacer." />
            </State>
            <State label="dossier survolé">
              <EmptyState variant="drop" title="Relâchez pour ajouter" over />
            </State>
            <State label="aucun résultat">
              <EmptyState
                variant="noresults"
                title="Aucun résultat"
                body="Rien ne correspond à « #airy bpm:>170 »."
                hints={["kick dark", "#warm -#bright", "bpm:120-128 key:Am"]}
              />
            </State>
          </>
        )}
      />
    </div>
  );
}
