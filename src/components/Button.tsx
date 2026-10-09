// Bouton texte. « primary » : l'action principale d'une vue (inversé, sans accent : l'ambre reste à la lecture).
import type { JSX } from "solid-js";

export function Button(props: {
  variant?: "primary" | "secondary";
  disabled?: boolean;
  onClick?: () => void;
  children: JSX.Element;
}) {
  return (
    <button class="cr-button" data-variant={props.variant ?? "secondary"} disabled={props.disabled} onClick={() => props.onClick?.()}>
      {props.children}
    </button>
  );
}
