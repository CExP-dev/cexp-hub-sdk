import { createCExP } from "./global";

export type { CExPApi, InitOptions } from "./types";

// Public singleton facade for ESM builds.
export const CExP = createCExP();

export const init = CExP.init;
export const identify = CExP.identify;
export const reset = CExP.reset;
export const version = CExP.version;

export const notification = CExP.notification;
export const gamification = CExP.gamification;

export default CExP;


