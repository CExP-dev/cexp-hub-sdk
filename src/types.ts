export type InitOptions = { id: string };

export type IntegrationToggles = {
  onesignal: boolean;
  gamification: boolean;
};

export interface CExPApi {
  init: (options: InitOptions) => void;
  track: (eventName: string, props?: Record<string, unknown>) => void;
  page: (pageProps?: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  version: string;
}
