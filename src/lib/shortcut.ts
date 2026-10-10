// Raccourci de la recherche depuis le DAW : capture au clavier, affichage à la Mac (⌃⌥⇧⌘), format du plugin Rust
// (« Cmd+KeyF » : modificateurs puis code physique de la touche, indépendant de la disposition du clavier).
import type { DawShortcutConfig } from "../api/bindings";

/** DAW proposés dans les Réglages, par identifiant d'app (bundle id). */
export const KNOWN_DAWS: { id: string; name: string }[] = [
  { id: "com.ableton.live", name: "Ableton Live" },
  { id: "com.bitwig.BitwigStudio", name: "Bitwig Studio" },
  { id: "com.apple.logic10", name: "Logic Pro" },
  { id: "com.cockos.reaper", name: "Reaper" },
  { id: "com.image-line.flstudio", name: "FL Studio" },
];

export const DEFAULT_DAW_SHORTCUT: DawShortcutConfig = {
  enabled: true,
  shortcut: "Cmd+KeyF",
  apps: ["com.ableton.live", "com.bitwig.BitwigStudio"],
};

const MODS: [keyof KeyboardEvent & string, string, string][] = [
  ["ctrlKey", "Ctrl", "⌃"],
  ["altKey", "Alt", "⌥"],
  ["shiftKey", "Shift", "⇧"],
  ["metaKey", "Cmd", "⌘"],
];

/** Raccourci tapé (au moins un modificateur et une vraie touche), sinon `null` (modificateur seul, touche seule). */
export function shortcutFromEvent(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (!e.code || /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/.test(e.code)) return null;
  const mods = MODS.filter(([k]) => e[k as "ctrlKey"]).map(([, name]) => name);
  return mods.length ? [...mods, e.code].join("+") : null;
}

/** « Cmd+KeyF » → « ⌘F », « Ctrl+Alt+Space » → « ⌃⌥Espace ». */
export function formatShortcut(s: string): string {
  const parts = s.split("+");
  const key = parts.pop() ?? "";
  const mods = MODS.filter(([, name]) => parts.some((p) => p.toLowerCase() === name.toLowerCase())).map(([, , sym]) => sym);
  const pretty = key
    .replace(/^Key([A-Z])$/, "$1")
    .replace(/^Digit(\d)$/, "$1")
    .replace(/^Space$/, "Espace")
    .replace(/^Arrow(Left|Right|Up|Down)$/, (_, d: string) => ({ Left: "←", Right: "→", Up: "↑", Down: "↓" })[d] ?? d);
  return mods.join("") + pretty;
}
