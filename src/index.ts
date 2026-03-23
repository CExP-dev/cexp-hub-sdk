import { createCExP } from "./global";

export type { CExPApi, InitOptions } from "./types";

// Public singleton facade for ESM builds.
export const CExP = createCExP();

export const init = CExP.init;
export const track = CExP.track;
export const page = CExP.page;
export const identify = CExP.identify;
export const reset = CExP.reset;
export const version = CExP.version;

export default CExP;


