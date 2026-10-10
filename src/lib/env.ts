/** Vrai dans la fenêtre Tauri, faux dans le navigateur et Storybook. */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
