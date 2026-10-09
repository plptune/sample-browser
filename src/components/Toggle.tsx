// Interrupteur on / off (réglages).
export function Toggle(props: { checked: boolean; label: string; onChange?: (v: boolean) => void }) {
  return (
    <button
      class="cr-switch"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      data-on={props.checked || undefined}
      onClick={() => props.onChange?.(!props.checked)}
    >
      <span class="cr-switch__thumb" />
    </button>
  );
}
