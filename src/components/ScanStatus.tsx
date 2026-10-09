import { Show } from "solid-js";

const fmt = new Intl.NumberFormat("fr-FR");

export function ScanStatus(props: { folder: string; done: number; total: number }) {
  return (
    <div class="cr-scan" role="status">
      <span class="cr-scan__label">Indexation de {props.folder}…</span>
      {/* 0 / 0 : parcours des dossiers, avant de savoir combien de fichiers lire. */}
      <Show when={props.total > 0}>
        <span class="cr-scan__count cr-num">
          {fmt.format(props.done)} / {fmt.format(props.total)}
        </span>
      </Show>
      <div class="cr-scan__bar">
        <div class="cr-scan__fill" style={{ width: `${(props.done / Math.max(1, props.total)) * 100}%` }} />
      </div>
    </div>
  );
}
