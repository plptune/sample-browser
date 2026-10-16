// Tags d'un sample (tiroir, preview) : ceux posés par l'analyse ou repris de Splice atténués ; × retire un tag (un tag
// automatique ou Splice retiré ne revient jamais). Le type (loop / one-shot) a sa propre catégorie, à côté.
import { For } from "solid-js";
import { Icon } from "./Icon";

export function TagChips(props: { tags: string[]; autoTags: string[]; spliceTags?: string[]; onRemove: (t: string) => void }) {
  const origin = (t: string) =>
    props.spliceTags?.includes(t) ? "From Splice" : props.autoTags.includes(t) ? "Found by the analysis" : undefined;
  return (
    <>
      <For each={props.tags}>
        {(t) => (
          <span
            class="cr-tag cr-tag--removable"
            data-auto={origin(t) ? true : undefined}
            title={origin(t)}
          >
            {t}
            <button class="cr-tag__remove" aria-label={`Remove tag ${t}`} onClick={() => props.onRemove(t)}>
              <Icon name="close" />
            </button>
          </span>
        )}
      </For>
    </>
  );
}
