import { normalizeNotificationPropertyForInit } from "./onesignalInitNormalize";
import { tryParseUnifiedControlConfig } from "./unifiedControl";

export type IntegrationKey = "notification" | "gamification";

export interface BasicIntegrationToggleConfig {
  enabled: boolean;
}

export interface NotificationIntegrationToggleConfig extends BasicIntegrationToggleConfig {
  /**
   * OneSignal web app id (UUID). Required for the SDK script to load when enabled.
   */
  appId?: string;
  autoResubscribe?: boolean;
  serviceWorkerEnabled?: boolean;
  serviceWorkerPath?: string;
  serviceWorkerParam?: Record<string, unknown>;
  notificationClickHandlerMatch?: string;
  notificationClickHandlerAction?: string;
  persistNotification?: boolean;
  /**
   * OneSignal prompt options subtree (wire shape is an object; keys are plugin-owned).
   * Kept as a generic object to avoid coupling the SDK to OneSignal's full option typings.
   */
  promptOptions?: Record<string, unknown>;
}

export interface GamificationIntegrationToggleConfig extends BasicIntegrationToggleConfig {
  /**
   * Optional remote override for the gamification integration.
   * Validated defensively during parsing.
   */
  packageVersion?: string;
  /**
   * Optional remote override for the gamification integration.
   * Validated defensively during parsing.
   */
  apiKey?: string;
  /**
   * CDP client key for JWT token flow (`GET {tokenBaseUrl}/sv/token`).
   * Validated defensively during parsing.
   */
  clientKey?: string;
  /**
   * HTTPS base URL (origin + `/gamification` path prefix) for the CDP token endpoint in this environment.
   * Validated defensively during parsing (host/path allowlist, `https` only, no trailing slash).
   */
  tokenBaseUrl?: string;
}

export interface IntegrationToggleConfigByKey {
  notification: NotificationIntegrationToggleConfig;
  gamification: GamificationIntegrationToggleConfig;
}

export interface ControlConfig {
  version: string;
  sdkId?: string;
  integrations: IntegrationToggleConfigByKey;
}

const INTEGRATION_KEYS: IntegrationKey[] = ["notification", "gamification"];

/**
 * Compare notification integration blocks for ETag / hub refresh (includes normalized promptOptions).
 */
export function areNotificationIntegrationConfigsEqual(
  a: NotificationIntegrationToggleConfig,
  b: NotificationIntegrationToggleConfig,
): boolean {
  if (a.enabled !== b.enabled) return false;
  if (a.appId !== b.appId) return false;
  if (a.autoResubscribe !== b.autoResubscribe) return false;
  if (a.serviceWorkerEnabled !== b.serviceWorkerEnabled) return false;
  if (a.serviceWorkerPath !== b.serviceWorkerPath) return false;
  if (JSON.stringify(a.serviceWorkerParam) !== JSON.stringify(b.serviceWorkerParam)) return false;
  if (a.notificationClickHandlerMatch !== b.notificationClickHandlerMatch) return false;
  if (a.notificationClickHandlerAction !== b.notificationClickHandlerAction) return false;
  if (a.persistNotification !== b.persistNotification) return false;

  const na =
    a.promptOptions === undefined
      ? undefined
      : normalizeNotificationPropertyForInit({ promptOptions: a.promptOptions } as Record<string, unknown>)
          .promptOptions;
  const nb =
    b.promptOptions === undefined
      ? undefined
      : normalizeNotificationPropertyForInit({ promptOptions: b.promptOptions } as Record<string, unknown>)
          .promptOptions;
  return JSON.stringify(na) === JSON.stringify(nb);
}

/**
 * Strict parse unified control wire JSON into a safe internal shape.
 * Never throws; returns `undefined` when the root payload is invalid.
 */
export function tryParseControlConfig(input: unknown): ControlConfig | undefined {
  return tryParseUnifiedControlConfig(input);
}

export function areControlConfigsEqual(a: ControlConfig, b: ControlConfig): boolean {
  if (a.version !== b.version) return false;
  if (a.sdkId !== b.sdkId) return false;

  for (const key of INTEGRATION_KEYS) {
    if (key === "gamification") {
      if (a.integrations.gamification.enabled !== b.integrations.gamification.enabled) return false;
      if (a.integrations.gamification.apiKey !== b.integrations.gamification.apiKey) return false;
      if (
        a.integrations.gamification.packageVersion !== b.integrations.gamification.packageVersion
      )
        return false;
      if (a.integrations.gamification.clientKey !== b.integrations.gamification.clientKey) {
        return false;
      }
      if (a.integrations.gamification.tokenBaseUrl !== b.integrations.gamification.tokenBaseUrl) {
        return false;
      }
    } else {
      if (!areNotificationIntegrationConfigsEqual(a.integrations.notification, b.integrations.notification)) {
        return false;
      }
    }
  }
  return true;
}
