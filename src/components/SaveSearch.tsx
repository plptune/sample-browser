// ⌘S sur une recherche : nommer la nouvelle collection smart. ⏎ enregistre, Échap annule.
import { onMount } from "solid-js";

export function SaveSearch(props: { value: string; onSubmit?: (name: string) => void; onCancel?: () => void; autofocus?: boolean }) {
  let input!: HTMLInputElement;
  onMount(() => {
    if (props.autofocus === false) return;
    input.focus({ preventScroll: true });
    input.select();
  });
  return (
    <div class="cr-save">
      <span class="cr-save__label">New smart collection</span>
      <input
        ref={input}
        class="cr-save__input"
        value={props.value}
        spellcheck={false}
        aria-label="Collection name"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") props.onSubmit?.(input.value);
          if (e.key === "Escape") props.onCancel?.();
        }}
      />
      <span class="cr-save__hint">⏎ save · esc cancel</span>
    </div>
  );
}
