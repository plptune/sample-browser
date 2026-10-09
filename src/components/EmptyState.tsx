import { For, Show, type JSX } from "solid-js";

export function EmptyState(props: {
  variant: "drop" | "noresults";
  title: string;
  body?: JSX.Element;
  hints?: string[];
  over?: boolean;
}) {
  return (
    <div class="cr-empty" data-variant={props.variant} data-over={props.over || undefined}>
      <div class="cr-empty__title">{props.title}</div>
      <Show when={props.body}>
        <div class="cr-empty__body">{props.body}</div>
      </Show>
      <Show when={props.hints?.length}>
        <div class="cr-empty__hints">
          <For each={props.hints}>{(h) => <span>{h}</span>}</For>
        </div>
      </Show>
    </div>
  );
}
