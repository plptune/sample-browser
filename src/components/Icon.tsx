// Jeu d'icônes volontairement minimal : 12×12, trait 1.2, couleur = currentColor.
import type { JSX } from "solid-js";

export type IconName = "search" | "chevron" | "back" | "play" | "stop" | "close" | "plus" | "settings" | "loop" | "check" | "minus" | "star" | "star-fill" | "virtual" | "collection" | "pin" | "alias" | "expand" | "collapse" | "folder" | "sample" | "midi" | "autoplay" | "filter" | "gear" | "folder-flat" | "library" | "layers";

// Fonctions et non éléments : un nœud DOM ne peut être monté qu'à un seul endroit.
const PATHS: Record<IconName, () => JSX.Element> = {
  search: () => (
    <>
      <circle cx="5.2" cy="5.2" r="3.4" />
      <path d="M7.7 7.7 10.6 10.6" />
    </>
  ),
  chevron: () => <path d="M4.5 2.8 7.7 6 4.5 9.2" />,
  back: () => <path d="M7.5 2.8 4.3 6l3.2 3.2" />,
  check: () => <path d="M2.8 6.2 5 8.4l4.2-4.8" />,
  minus: () => <path d="M3 6h6" />,
  // Dossier en pointillés : « virtuel », rien sur le disque.
  virtual: () => <path d="M1.6 3.2h3.1l1 1.2h4.7v5.2H1.6z" stroke-dasharray="1.4 1.1" />,
  collection: () => <path d="M3.6 3.4h6.4M3.6 6h6.4M3.6 8.6h6.4M1.8 3.4h.1M1.8 6h.1M1.8 8.6h.1" />,
  // Flèche d'alias (comme dans le Finder) : raccourci vers un dossier réel.
  alias: () => <path d="M3.2 8.8 8.4 3.6M4.6 3.4h4v4" />,
  pin: () => <path d="M4.6 1.8h2.8l-.4 2.8 1.6 1.6H3.4L5 4.6zM6 6.2v4" />,
  star: () => <path d="M6 1.9 7.2 4.5l2.8.3-2.1 1.9.6 2.8L6 8.1 3.5 9.5l.6-2.8L2 4.8l2.8-.3z" />,
  "star-fill": () => <path d="M6 1.9 7.2 4.5l2.8.3-2.1 1.9.6 2.8L6 8.1 3.5 9.5l.6-2.8L2 4.8l2.8-.3z" fill="currentColor" />,
  play: () => <path d="M3.5 2.2v7.6L9.8 6z" fill="currentColor" stroke="none" />,
  stop: () => <rect x="3" y="3" width="6" height="6" fill="currentColor" stroke="none" />,
  close: () => <path d="M3.2 3.2l5.6 5.6M8.8 3.2 3.2 8.8" />,
  plus: () => <path d="M6 2.5v7M2.5 6h7" />,
  settings: () => <path d="M2 3.5h8M2 8.5h8M4.5 2v3M7.5 7v3" />,
  // Agrandir / revenir en colonne : flèches vers les coins, ou vers le centre.
  expand: () => <path d="M7 2h3v3M10 2 6.9 5.1M5 10H2V7M2 10l3.1-3.1" />,
  collapse: () => <path d="M10 2 7.1 4.9M7.1 2.6v2.3h2.3M2 10l2.9-2.9M4.9 9.4V7.1H2.6" />,
  // Type des lignes de l'arbre : dossier (trait plein, le dossier virtuel est pointillé), sample (onde), MIDI (note).
  folder: () => <path d="M1.6 3.2h3.1l1 1.2h4.7v5.2H1.6z" />,
  sample: () => <path d="M1.6 6h.4M3.4 4.4v3.2M5.2 2.4v7.2M7 3.8v4.4M8.8 5v2M10.4 6h.1" />,
  midi: () => (
    <>
      <circle cx="4" cy="9" r="1.5" />
      <path d="M5.5 9V2.2l4 1.3v2" />
    </>
  ),
  // Filtres actifs (dossiers aplatis…) : un entonnoir.
  filter: () => <path d="M1.8 2.4h8.4L7 6.2v3.1L5 10.2V6.2z" />,
  // Options de recherche : un engrenage (distinct des curseurs des Réglages de l'app).
  gear: () => (
    <>
      <circle cx="6" cy="6" r="1.6" />
      <path d="M6 1.4v1.4M6 9.2v1.4M1.4 6h1.4M9.2 6h1.4M2.75 2.75l1 1M8.25 8.25l1 1M2.75 9.25l1-1M8.25 3.75l1-1" />
    </>
  ),
  // Dossier aplati (filtre temporaire) : un dossier marqué d'un astérisque.
  "folder-flat": () => (
    <>
      <path d="M1.6 3.2h3.1l1 1.2h1.6M10.4 6.4v3.2H1.6V3.2" />
      <path d="M9.2 1.6v3M7.9 2.35l2.6 1.5M7.9 3.85l2.6-1.5" />
    </>
  ),
  // Onglets : Bibliothèque (étagère de sources) et Virtuels (calques : rangements qui se superposent aux dossiers).
  library: () => <path d="M2 2.2v7.6M4.6 2.2v7.6M7.2 2.8l2.6 7M1.4 9.8h9.2" />,
  layers: () => <path d="M6 1.8 10.4 4 6 6.2 1.6 4zM1.6 6.2 6 8.4l4.4-2.2M1.6 8.2 6 10.4l4.4-2.2" />,
  // Lecture auto : une liste qui se lit d'elle-même.
  autoplay: () => (
    <>
      <path d="M1.8 3h5.4M1.8 6h3.4M1.8 9h3.4" />
      <path d="M7.2 5.4v4.4L10.6 7.6z" fill="currentColor" stroke="none" />
    </>
  ),
  loop: () => <path d="M2.5 6.5V5.5a2 2 0 0 1 2-2h4.5M7.5 2l1.5 1.5L7.5 5M9.5 5.5v1a2 2 0 0 1-2 2H3M4.5 10 3 8.5 4.5 7" />,
};

export function Icon(props: { name: IconName; class?: string }) {
  return (
    <svg
      class={`cr-icon ${props.class ?? ""}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[props.name]()}
    </svg>
  );
}

export function Chevron(props: { open?: boolean }) {
  return (
    <svg class="cr-chevron" data-open={props.open || undefined} viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4.5 2.8 7.7 6 4.5 9.2" />
    </svg>
  );
}
