import { defineConfig } from "tsup";

export default defineConfig([
  // ESM + CJS: dual package for import / require (e.g. jsDelivr, Node CJS).
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    sourcemap: false,
    clean: true,
    splitting: false,
    dts: true,
  },
  // IIFE build: single file for <script src="..."> (older browsers, no module graph).
  // Do not set `globalName`: it emits `var CExP = (function(){...})()` which overwrites
  // `window.CExP` with `undefined` after `src/browser.ts` assigns the API (browser global binding).
  {
    entry: ["src/browser.ts"],
    format: ["iife"],
    target: "es2018",
    sourcemap: false,
    clean: true,
    splitting: false,
    dts: false,
  },
]);
