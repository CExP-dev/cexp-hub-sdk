import type { CExPApi, InitOptions } from "./types";

const DEFAULT_VERSION = "0.1.0";

export function createCExP(): CExPApi {
  let initialized = false;
  let anonymousId: string | undefined;

  const requireInit = (methodName: string) => {
    if (!initialized) {
      throw new Error(`[CExP] Cannot call '${methodName}' before init({ id })`);
    }
  };

  const generateAnonymousId = () => {
    // Avoid depending on `crypto` availability across all JS runtimes.
    return Math.random().toString(36).slice(2);
  };

  const api: CExPApi = {
    version: DEFAULT_VERSION,

    init: (options: InitOptions) => {
      if (!options?.id) {
        throw new Error("[CExP] init({ id }) is required");
      }
      initialized = true;
    },

    track: (event: unknown) => {
      requireInit("track");
      void event; // Stub for Task 3+ routing/control logic.
    },

    page: (page: unknown) => {
      requireInit("page");
      void page; // Stub for Task 3+ routing/control logic.
    },

    identify: (identity: unknown) => {
      requireInit("identify");
      void identity; // Stub for Task 3+ routing/control logic.
    },

    reset: () => {
      requireInit("reset");
      initialized = false;
      anonymousId = undefined;
    },

    getAnonymousId: () => {
      requireInit("getAnonymousId");
      if (!anonymousId) anonymousId = generateAnonymousId();
      return anonymousId;
    },
  };

  return api;
}

