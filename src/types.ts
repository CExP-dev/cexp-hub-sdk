export type InitOptions = { id: string };

export interface CExPApi {
  init: (options: InitOptions) => void;
  track: (event: unknown) => void;
  page: (page: unknown) => void;
  identify: (identity: unknown) => void;
  reset: () => void;
  /**
   * Optional internal helper.
   * Not part of the public facade yet, but included for upcoming global-id plumbing.
   */
  getAnonymousId?: () => string;
  version: string;
}

