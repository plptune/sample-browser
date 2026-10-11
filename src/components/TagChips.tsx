// Tags d'un sample (tiroir, inspecteur) : d'abord son type (loop / oneshot, non retirable), puis ses tags, ceux posés
// par l'analyse atténués ; × retire un tag (un tag automatique retiré ne revient jamais).
import { For } from "solid-js";
import type { SampleKind } from "../api";
import { Icon } from "./Icon";

export function TagChips(props: { kind: SampleKind; tags: string[]; autoTags: string[]; onRemove: (t: string) => void }) {
  return (
    <>
      <span class="cr-tag" data-kind-tag title={props.kind === "loop" ? "Loop (type:loop)" : "One-shot (type:oneshot)"}>
        {props.kind}
      </span>
      <For each={props.tags}>
        {(t) => (
          <span
            class="cr-tag cr-tag--removable"
            data-auto={props.autoTags.includes(t) || undefined}
            title={props.autoTags.includes(t) ? "Found by the analysis" : undefined}
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
