import { createCExP } from "./global";

// Browser/IIFE entry: classic <script src> exposes `window.CExP` (no ES modules).
const CExP = createCExP();
(window as unknown as { CExP: typeof CExP }).CExP = CExP;

