export type InitOptions = { id: string };

export type IntegrationToggles = {
  notification: boolean;
  gamification: boolean;
};

export interface CExPApi {
  init: (options: InitOptions) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  version: string;
}
