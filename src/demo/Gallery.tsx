// Galerie : chaque composant dans chacun de ses états, sombre / clair, à 260 et 380 px.
import { For, type JSX } from "solid-js";
import { Autocomplete } from "../components/Autocomplete";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/IconButton";
import { PreviewDrawer } from "../components/PreviewDrawer";
import { QueryChip } from "../components/QueryChip";
import { ScanStatus } from "../components/ScanStatus";
import { TagPill } from "../components/TagPill";
import { TreeRow } from "../components/TreeRow";
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

      <h2>TreeRow · arbre</h2>
      <Frames
        render={(theme) => (
          <>
            <State label="dossiers : fermé · ouvert · niveaux · hors ligne · collections">
              <div class="cr-tree" style={{ flex: "none" }}>
                <TreeRow kind="folder" label="Splice" depth={0} />
                <TreeRow kind="folder" label="Samples" depth={0} open />
                <TreeRow kind="folder" label="Drums" depth={1} open selected />
                <TreeRow kind="folder" label="Kicks" depth={2} />
                <TreeRow kind="sample" label={loop.name} depth={2} bpm={loop.bpm} keyName={loop.key} />
                <TreeRow kind="folder" label="Field Recordings" depth={0} offline />
                <TreeRow kind="group" label="Collections" depth={0} open />
                <TreeRow kind="collection" label="Night Drive" depth={1} dropTarget />
                <TreeRow kind="smart" label="Loops en Am" depth={1} />
              </div>
            </State>
            <State label="samples, arbre focus : défaut · sélection · lecture · drag · introuvable">
              <div class="cr-tree" data-focused style={{ flex: "none" }}>
                <TreeRow kind="sample" label={kick.name} depth={1} />
                <TreeRow kind="sample" label={kick2.name} depth={1} selected />
                <TreeRow kind="sample" label={loop.name} depth={1} bpm={loop.bpm} keyName={loop.key} playing progress={0.4} />
                <TreeRow kind="sample" label={kick.name} depth={1} dragging />
                <TreeRow kind="sample" label={missing.name} depth={1} missing />
              </div>
            </State>
            <State label="mode waveform (36 px)">
              <div class="cr-tree" data-focused style={{ flex: "none" }}>
                <TreeRow kind="sample" label={kick.name} depth={1} wave peaks={kick.peaks} themeKey={theme} />
                <TreeRow kind="sample" label={loop.name} depth={1} bpm={loop.bpm} keyName={loop.key} wave peaks={loop.peaks} selected playing progress={0.4} themeKey={theme} />
              </div>
            </State>
          </>
        )}
      />

      <h2>PreviewDrawer</h2>
      <Frames
        render={(theme) => (
          <>
            <State label="aucun sample">
              <PreviewDrawer playing={false} progress={0} />
            </State>
            <State label="arrêt">
              <PreviewDrawer sample={kick} playing={false} progress={0} themeKey={theme} />
            </State>
            <State label="lecture 40 %">
              <PreviewDrawer sample={loop} playing progress={0.4} themeKey={theme} />
            </State>
            <State label="introuvable">
              <PreviewDrawer sample={missing} playing={false} progress={0} />
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
