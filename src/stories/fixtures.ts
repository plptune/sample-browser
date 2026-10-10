// Samples fixes pour les stories (issus des mocks déterministes).
import { SAMPLES } from "../mock/generate";

const find = (p: string, n = 0) => SAMPLES.filter((s) => s.name.startsWith(p))[n];

export const kick = { ...find("Kick", 3), missing: false };
export const loop = { ...find("Keys_Loop", 2), missing: false };
export const missing = { ...find("Clap", 1), missing: true };
