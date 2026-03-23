import { defineConfig } from "tsup";

export default defineConfig([
  // ESM build: exports the module surface (no global attachment).
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    sourcemap: true,
    clean: true,
    splitting: false,
    dts: true,
  },
  // IIFE build: attaches `window.CExP` unconditionally.
  {
    entry: ["src/browser.ts"],
    format: ["iife"],
    globalName: "CExP",
    sourcemap: true,
    clean: false,
    splitting: false,
    dts: false,
  },
]);

