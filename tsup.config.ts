import { defineConfig } from "tsup";

export default defineConfig([
  // ESM + CJS: dual package for import / require (e.g. jsDelivr, Node CJS).
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    sourcemap: true,
    clean: true,
    splitting: false,
    dts: true,
  },
  // IIFE build: single file for <script src="..."> (older browsers, no module graph).
  {
    entry: ["src/browser.ts"],
    format: ["iife"],
    globalName: "CExP",
    target: "es2018",
    sourcemap: true,
    clean: false,
    splitting: false,
    dts: false,
  },
]);

