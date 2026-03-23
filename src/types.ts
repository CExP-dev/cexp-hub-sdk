export type InitOptions = { id: string };

export interface CExPApi {
  init: (options: InitOptions) => void;
  track: (event: unknown) => void;
  page: (page: unknown) => void;
  identify: (identity: unknown) => void;
  reset: () => void;
  /**
   * Returns an anonymous id for the current runtime.
   */
  getAnonymousId?: () => string;
  version: string;
}

