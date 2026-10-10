export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return s.toFixed(2);
  if (s < 60) return s.toFixed(1);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}
