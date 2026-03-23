import { createCExP } from "./global";

export type { CExPApi, InitOptions } from "./types";

// Public singleton facade for browser/IIFE builds (`window.CExP`).
export const CExP = createCExP();

// Also export the instance methods at the top level so the IIFE global
// (`window.CExP`) has `init()` / `track()` directly (no nesting).
export const init = CExP.init;
export const track = CExP.track;
export const page = CExP.page;
export const identify = CExP.identify;
export const reset = CExP.reset;
export const getAnonymousId = CExP.getAnonymousId;
export const version = CExP.version;

// Only attach when loaded as a script in a browser-like environment.
// In test runners (jsdom) we can have `window`, but `document.currentScript`
// is typically null for module imports. This avoids polluting the test global.
const shouldAttachGlobalCExP =
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !!document.currentScript;

if (shouldAttachGlobalCExP) {
  (globalThis as unknown as { CExP: typeof CExP }).CExP = CExP;
}

export default CExP;


