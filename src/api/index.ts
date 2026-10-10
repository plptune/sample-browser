// Point d'entrée unique de l'UI vers le backend.
// Dans la fenêtre Tauri : commandes Rust (tauri.ts). Ailleurs (navigateur, Storybook, Pages) : mock.ts.
import { inTauri } from "../lib/env";
import { mockBackend, mockSetMissing } from "./mock";
import { tauriBackend, tauriDemoSetMissing } from "./tauri";
import type { Backend } from "./types";

export const api: Backend = inTauri ? tauriBackend : mockBackend;

/** Démo uniquement (scénario « Erreurs ») : marque des fichiers comme introuvables. */
export const demoSetMissing = async (ids: number[]) => (inTauri ? tauriDemoSetMissing(ids) : mockSetMissing(ids));

export type * from "./types";
