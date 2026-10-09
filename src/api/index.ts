// Point d'entrée unique de l'UI vers le backend.
// Phase 1 : remplacer par `export const api: Backend = tauriBackend;` (src/api/tauri.ts, via invoke()).
import { mockBackend } from "./mock";
import type { Backend } from "./types";

export const api: Backend = mockBackend;
export type * from "./types";
