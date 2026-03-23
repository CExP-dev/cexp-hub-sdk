import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "iife"],
  globalName: "CExP",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true
});

