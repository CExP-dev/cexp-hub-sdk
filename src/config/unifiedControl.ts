import type {
  ControlConfig,
  GamificationIntegrationToggleConfig,
  NotificationIntegrationToggleConfig,
} from "./schema";
import {
  isPlainObject,
  safeNonEmptyString,
  safePackageVersion,
  safeTokenBaseUrl,
} from "./controlParseHelpers";
import { normalizeNotificationPropertyForInit } from "./onesignalInitNormalize";

const MODULE_TYPE_NOTIFICATION = "NOTIFICATION";
const MODULE_TYPE_GAMIFICATION = "GAMIFICATION";
export type ModuleTypeName =
  | typeof MODULE_TYPE_NOTIFICATION
  | typeof MODULE_TYPE_GAMIFICATION;

function parseWireVersion(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function parseSdkId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

export function extractFirstModule(
  modules: unknown[],
  type: ModuleTypeName
): Record<string, unknown> | undefined {
  for (const m of modules) {
    if (!isPlainObject(m)) continue;
    if (m.type === type) return m;
  }
  return undefined;
}

/**
 * Valid plain object → property record. Missing key → `{}`. Present but invalid → `undefined` (module off).
 */
export function resolveModuleProperty(
  module: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(module, "property")) {
    return {};
  }
  const p = module.property;
  if (p === undefined) return {};
  if (!isPlainObject(p)) return undefined;
  return p;
}

function pickNotificationConfig(
  property: Record<string, unknown>
): NotificationIntegrationToggleConfig {
  const normalized = normalizeNotificationPropertyForInit(property) as Record<
    string,
    unknown
  >;
  const out: NotificationIntegrationToggleConfig = { enabled: true };

  const appId = safeNonEmptyString(normalized.appId);
  if (appId !== undefined) out.appId = appId;

  if (typeof normalized.autoResubscribe === "boolean")
    out.autoResubscribe = normalized.autoResubscribe;
  if (typeof normalized.serviceWorkerEnabled === "boolean")
    out.serviceWorkerEnabled = normalized.serviceWorkerEnabled;
  if (typeof normalized.serviceWorkerPath === "string")
    out.serviceWorkerPath = normalized.serviceWorkerPath;
  if (isPlainObject(normalized.serviceWorkerParam)) {
    out.serviceWorkerParam = normalized.serviceWorkerParam;
  }
  if (typeof normalized.notificationClickHandlerMatch === "string") {
    out.notificationClickHandlerMatch =
      normalized.notificationClickHandlerMatch;
  }
  if (typeof normalized.notificationClickHandlerAction === "string") {
    out.notificationClickHandlerAction =
      normalized.notificationClickHandlerAction;
  }
  if (typeof normalized.persistNotification === "boolean") {
    out.persistNotification = normalized.persistNotification;
  }
  if (isPlainObject(normalized.promptOptions))
    out.promptOptions = normalized.promptOptions;

  return out;
}

function pickGamificationConfig(
  property: Record<string, unknown>
): GamificationIntegrationToggleConfig {
  const out: GamificationIntegrationToggleConfig = { enabled: true };
  const apiKey = safeNonEmptyString(property.apiKey);
  const packageVersion = safePackageVersion(property.packageVersion);
  const clientKey = safeNonEmptyString(property.clientKey);
  const tokenBaseUrl = safeTokenBaseUrl(property.tokenBaseUrl);
  if (apiKey !== undefined) out.apiKey = apiKey;
  if (packageVersion !== undefined) out.packageVersion = packageVersion;
  if (clientKey !== undefined) out.clientKey = clientKey;
  if (tokenBaseUrl !== undefined) out.tokenBaseUrl = tokenBaseUrl;
  return out;
}

function parseModulesPayload(
  input: Record<string, unknown>,
  version: string
): ControlConfig {
  const sdkId = parseSdkId(input.sdkId);

  const modules = input.modules as unknown[];
  const notifModule = extractFirstModule(modules, MODULE_TYPE_NOTIFICATION);
  const gamModule = extractFirstModule(modules, MODULE_TYPE_GAMIFICATION);

  let notification: NotificationIntegrationToggleConfig;
  if (!notifModule) {
    notification = { enabled: false };
  } else {
    const prop = resolveModuleProperty(notifModule);
    if (prop === undefined) {
      notification = { enabled: false };
    } else {
      notification = pickNotificationConfig(prop);
    }
  }

  let gamification: GamificationIntegrationToggleConfig;
  if (!gamModule) {
    gamification = { enabled: false };
  } else {
    const prop = resolveModuleProperty(gamModule);
    if (prop === undefined) {
      gamification = { enabled: false };
    } else {
      gamification = pickGamificationConfig(prop);
    }
  }

  const cfg: ControlConfig = {
    version,
    integrations: { notification, gamification },
  };
  if (sdkId !== undefined) cfg.sdkId = sdkId;
  return cfg;
}

export function tryParseUnifiedControlConfig(
  input: unknown
): ControlConfig | undefined {
  try {
    if (!isPlainObject(input)) return undefined;

    const version = parseWireVersion(input.version);
    if (version === undefined) return undefined;

    if (!Array.isArray(input.modules)) return undefined;
    return parseModulesPayload(input, version);
  } catch {
    return undefined;
  }
}
