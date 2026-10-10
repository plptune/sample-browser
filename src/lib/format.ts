export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return s.toFixed(2);
  if (s < 60) return s.toFixed(1);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

/** Fichier MIDI (joué au piano dans l'app). */
export function isMidi(s: { ext: string }): boolean {
  return s.ext === "mid" || s.ext === "midi";
}

/** Format court d'un fichier : « wav · 44,1 kHz · 24 bits », « MIDI ». */
export function formatFormat(s: { ext: string; sampleRate: number; bitDepth: number }): string {
  if (isMidi(s)) return "MIDI";
  const parts = [s.ext];
  if (s.sampleRate) parts.push(`${(s.sampleRate / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kHz`);
  if (s.bitDepth) parts.push(`${s.bitDepth} bits`);
  return parts.join(" · ");
}

/** Canaux en clair : mono, stéréo, n canaux (rien pour un MIDI). */
export function formatChannels(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "mono" : n === 2 ? "stéréo" : `${n} canaux`;
}
