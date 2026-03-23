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

// Safe for ESM/SSR imports: only attach when a browser global is available.
if (typeof window !== "undefined") {
  (globalThis as unknown as { CExP?: typeof CExP }).CExP = CExP;
}

export default CExP;


