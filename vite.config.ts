/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// GitHub Pages serves the project under /Seedscape/. Setting `base` makes Vite
// rewrite all asset URLs (entry script, favicon, atlas.png, worker chunks) to
// that prefix on build. Local dev (`npm run dev`) still serves at /.
export default defineConfig({
  base: "/Seedscape/",
  build: {
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
