const fmt = new Intl.NumberFormat("fr-FR");

export function ScanStatus(props: { folder: string; done: number; total: number }) {
  return (
    <div class="cr-scan" role="status">
      <span class="cr-scan__label">Indexation de {props.folder}…</span>
      <span class="cr-scan__count cr-num">
        {fmt.format(props.done)} / {fmt.format(props.total)}
      </span>
      <div class="cr-scan__bar">
        <div class="cr-scan__fill" style={{ width: `${(props.done / Math.max(1, props.total)) * 100}%` }} />
      </div>
    </div>
  );
}
