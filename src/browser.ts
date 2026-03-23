import { createCExP } from "./global";

// Browser/IIFE entry: attach unconditionally for `window.CExP`.
const CExP = createCExP();
(globalThis as unknown as { CExP: typeof CExP }).CExP = CExP;

