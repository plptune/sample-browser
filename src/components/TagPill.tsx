export function TagPill(props: { name: string; active?: boolean; variant?: "add"; onClick?: () => void }) {
  return (
    <button class="cr-tag" data-active={props.active || undefined} data-variant={props.variant} onClick={() => props.onClick?.()}>
      {props.variant === "add" ? "+ tag" : props.name}
    </button>
  );
}
