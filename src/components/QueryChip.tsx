import { Show } from "solid-js";
import { chipParts } from "../lib/query";

/** Token reconnu de la recherche. Clic = éditer, ⌫ dans le champ vide = supprimer. */
export function QueryChip(props: { raw: string; pending?: boolean; onClick?: () => void }) {
  const parts = () => chipParts(props.raw);
  return (
    <span
      class="cr-chip"
      data-kind={parts().exclude ? "exclude" : parts().key ? "filter" : "tag"}
      data-pending={props.pending || undefined}
      onMouseDown={(e) => {
        e.preventDefault();
        props.onClick?.();
      }}
    >
      <Show when={parts().key}>
        <span class="cr-chip__key">{parts().key}</span>
      </Show>
      <span class="cr-chip__val cr-num">{parts().value}</span>
    </span>
  );
}
