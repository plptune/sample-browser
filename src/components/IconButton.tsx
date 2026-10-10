import { Icon, type IconName } from "./Icon";

export function IconButton(props: {
  icon: IconName;
  label: string;
  active?: boolean;
  accent?: boolean;
  /** Couleur primaire (un filtre est actif). */
  primary?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  ref?: (el: HTMLButtonElement) => void;
}) {
  return (
    <button
      ref={props.ref}
      class="cr-icon-btn"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active ?? undefined}
      data-active={props.active || undefined}
      data-accent={props.accent || undefined}
      data-primary={props.primary || undefined}
      disabled={props.disabled}
      onClick={(e) => props.onClick?.(e)}
    >
      <Icon name={props.icon} />
    </button>
  );
}
