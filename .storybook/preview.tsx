import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "storybook-solidjs-vite";
import "../src/styles/tokens.css";
import "../src/styles/bundle.css";
import "./preview.css";

const preview: Preview = {
  globalTypes: {
    width: {
      description: "Largeur du panneau",
      toolbar: { title: "Largeur", icon: "component", items: ["260", "320", "380", "520"], dynamicTitle: true },
    },
  },
  initialGlobals: { width: "320" },
  parameters: {
    layout: "centered",
    controls: { expanded: true },
  },
  decorators: [
    // Chaque story est rendue dans une colonne de la largeur choisie, comme dans l'app.
    (Story, ctx) =>
      ctx.parameters.panel === false ? (
        <Story />
      ) : (
        <div
          class="cr-root cr-panel sb-panel"
          style={{ width: `${ctx.globals.width}px`, height: ctx.parameters.panelHeight ?? "auto" }}
        >
          <Story />
        </div>
      ),
    withThemeByDataAttribute({
      themes: { Sombre: "dark", Clair: "light" },
      defaultTheme: "Sombre",
      attributeName: "data-theme",
    }),
  ],
};

export default preview;
