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
  if (s.sampleRate) parts.push(`${(s.sampleRate / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} kHz`);
  if (s.bitDepth) parts.push(`${s.bitDepth} bits`);
  return parts.join(" · ");
}

/** Canaux en clair : mono, stéréo, n canaux (rien pour un MIDI). */
export function formatChannels(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "mono" : n === 2 ? "stereo" : `${n} channels`;
}

/**
 * Dossier d'un sample relatif à sa source (Réglages › Sources), pour le tiroir : « Drums/Kicks/Analog Col…/ ».
 * Chaque dossier est coupé à `max` caractères (+ « … ») ; la ligne entière est tronquée par le CSS si besoin.
 */
export function relativeFolder(path: string, sources: { path: string }[], max = 10): string {
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const root = sources
    .map((s) => s.path.replace(/\/+$/, "") + "/")
    .filter((r) => dir.startsWith(r))
    .sort((a, b) => b.length - a.length)[0];
  const rel = root ? dir.slice(root.length) : dir;
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return "/";
  return parts.map((p) => (p.length > max ? p.slice(0, max) + "…" : p)).join("/") + "/";
}
