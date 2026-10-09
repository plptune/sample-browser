import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Port fixe + pas d'ouverture auto : prêt pour `tauri dev` (devUrl) en phase 1.
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari16" },
});
