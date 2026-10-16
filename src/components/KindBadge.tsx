// Type d'un sample en badge icône : flèches en boucle (loop), flèche de gauche à droite (one-shot). Le texte reste dans
// l'infobulle et le nom accessible. Preview, premier tag du tiroir, colonne Tags de la liste.
import type { SampleKind } from "../api";
import { Icon } from "./Icon";

export const kindLabel = (kind: SampleKind) => (kind === "loop" ? "Loop (type:loop)" : "One-shot (type:oneshot)");

export function KindBadge(props: { kind: SampleKind }) {
  return (
    <span class="cr-kind" data-kind={props.kind} role="img" title={kindLabel(props.kind)} aria-label={kindLabel(props.kind)}>
      <Icon name={props.kind === "loop" ? "loop" : "oneshot"} />
    </span>
  );
}
