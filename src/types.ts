export type InitOptions = { id: string };

export type IntegrationToggles = {
  notification: boolean;
  gamification: boolean;
};

export interface CExPNotificationApi {
  identify: (userId: string) => void;
  reset: () => void;
}

export interface CExPGamificationApi {
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
}

export interface CExPApi {
  // Stable lifecycle
  init: (options: InitOptions) => void;
  version: string;

  // Backwards-compatible fan-out routing (existing behavior)
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;

  // Integration-owned namespaces (preferred)
  notification: CExPNotificationApi;
  gamification: CExPGamificationApi;
}
