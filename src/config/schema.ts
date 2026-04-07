export type IntegrationKey = "notification" | "gamification";

export interface BasicIntegrationToggleConfig {
  enabled: boolean;
}

export interface NotificationIntegrationToggleConfig extends BasicIntegrationToggleConfig {
  /**
   * OneSignal web app id (UUID). Required for the SDK script to load when enabled.
   */
  appId?: string;
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
  version: number;
  integrations: IntegrationToggleConfigByKey;
}

const INTEGRATION_KEYS: IntegrationKey[] = ["notification", "gamification"];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  // Strictly require an object literal-like shape (no arrays); tolerate null-proto objects.
  try {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const safeBoolean = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

const safeNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

// Interpolated only into a jsDelivr version segment on a fixed host.
// We disallow `/` and whitespace by restricting the full allowed character set.
const GAMIFICATION_PACKAGE_VERSION_ALLOWLIST = /^[0-9A-Za-z][0-9A-Za-z+._-]*$/;
const GAMIFICATION_PACKAGE_VERSION_MAX_LENGTH = 128;

/** Agreed with platform security: `*.cads.live` and path prefix `/gamification`. */
const GAMIFICATION_TOKEN_BASE_URL_MAX_LENGTH = 512;

const isAllowedGamificationTokenHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  return h === "cads.live" || h.endsWith(".cads.live");
};

/**
 * Accepts `https` URLs on allowlisted hosts with pathname prefix `/gamification`.
 * Strips trailing slashes and drops URL `search` / `hash` so the stored value is stable.
 */
const safeTokenBaseUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.length > GAMIFICATION_TOKEN_BASE_URL_MAX_LENGTH) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!isAllowedGamificationTokenHost(url.hostname)) return undefined;
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.length === 0) pathname = "/";
  if (!pathname.startsWith("/gamification")) return undefined;
  url.pathname = pathname;
  const serialized = url.toString().replace(/\/+$/, "");
  return serialized.length > 0 ? serialized : undefined;
};

const safePackageVersion = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.length > GAMIFICATION_PACKAGE_VERSION_MAX_LENGTH) return undefined;
  if (!GAMIFICATION_PACKAGE_VERSION_ALLOWLIST.test(value)) return undefined;
  return value;
};

/**
 * Parse remote control JSON into a safe internal shape.
 * Never throws: it tolerates missing fields and ignores unknown keys.
 */
export function parseControlConfig(input: unknown): ControlConfig {
  const defaults: ControlConfig = {
    version: 0,
    integrations: {
      notification: { enabled: false },
      gamification: { enabled: false },
    },
  };

  if (!isRecord(input)) return defaults;

  const version =
    typeof input.version === "number" && Number.isFinite(input.version) ? input.version : defaults.version;

  const integrationsInput = isRecord(input.integrations) ? input.integrations : undefined;

  const integrations: ControlConfig["integrations"] = {
    notification: { enabled: false },
    gamification: { enabled: false },
  };

  for (const key of INTEGRATION_KEYS) {
    const block = integrationsInput?.[key];
    const enabled = isRecord(block) ? safeBoolean(block.enabled) : undefined;
    if (key === "gamification") {
      const apiKey = isRecord(block) ? safeNonEmptyString(block.apiKey) : undefined;
      const packageVersion = isRecord(block) ? safePackageVersion(block.packageVersion) : undefined;
      const clientKey = isRecord(block) ? safeNonEmptyString(block.clientKey) : undefined;
      const tokenBaseUrl = isRecord(block) ? safeTokenBaseUrl(block.tokenBaseUrl) : undefined;

      const gamification: GamificationIntegrationToggleConfig = { enabled: enabled ?? false };
      if (apiKey !== undefined) gamification.apiKey = apiKey;
      if (packageVersion !== undefined) gamification.packageVersion = packageVersion;
      if (clientKey !== undefined) gamification.clientKey = clientKey;
      if (tokenBaseUrl !== undefined) gamification.tokenBaseUrl = tokenBaseUrl;

      integrations.gamification = gamification;
    } else {
      const appId = isRecord(block) ? safeNonEmptyString((block as Record<string, unknown>).appId) : undefined;
      const notification: NotificationIntegrationToggleConfig = { enabled: enabled ?? false };
      if (appId !== undefined) notification.appId = appId;
      integrations.notification = notification;
    }
  }

  return { version, integrations };
}

/**
 * Strict parse a remote control payload into a safe internal shape.
 *
 * Rules:
 * - input must be a plain object
 * - `version` must exist and be a finite number
 * - `integrations` must exist and be a plain object
 * - for each known integration key:
 *   - missing block => enabled false
 *   - present block => must be plain object and `enabled` must be boolean
 * - unknown keys are ignored
 *
 * Never throws; returns `undefined` on any validation failure.
 */
export function tryParseControlConfig(input: unknown): ControlConfig | undefined {
  try {
    if (!isPlainObject(input)) return undefined;

    const version = (input as Record<string, unknown>).version;
    if (typeof version !== "number" || !Number.isFinite(version)) return undefined;

    const integrationsInput = (input as Record<string, unknown>).integrations;
    if (!isPlainObject(integrationsInput)) return undefined;

    const integrations: ControlConfig["integrations"] = {
      notification: { enabled: false },
      gamification: { enabled: false },
    };

    for (const key of INTEGRATION_KEYS) {
      const integrationsHasOwnKey = Object.prototype.hasOwnProperty.call(integrationsInput, key);
      if (!integrationsHasOwnKey) {
        integrations[key] = { enabled: false } as IntegrationToggleConfigByKey[typeof key];
        continue;
      }

      const block = (integrationsInput as Record<string, unknown>)[key];
      if (!isPlainObject(block)) return undefined;

      const enabled = (block as Record<string, unknown>).enabled;
      if (typeof enabled !== "boolean") return undefined;

      if (key === "gamification") {
        const apiKey = safeNonEmptyString((block as Record<string, unknown>).apiKey);
        const packageVersion = safePackageVersion((block as Record<string, unknown>).packageVersion);
        const clientKey = safeNonEmptyString((block as Record<string, unknown>).clientKey);
        const tokenBaseUrl = safeTokenBaseUrl((block as Record<string, unknown>).tokenBaseUrl);

        const gamification: GamificationIntegrationToggleConfig = { enabled };
        if (apiKey !== undefined) gamification.apiKey = apiKey;
        if (packageVersion !== undefined) gamification.packageVersion = packageVersion;
        if (clientKey !== undefined) gamification.clientKey = clientKey;
        if (tokenBaseUrl !== undefined) gamification.tokenBaseUrl = tokenBaseUrl;
        integrations.gamification = gamification;
      } else {
        const appId = safeNonEmptyString((block as Record<string, unknown>).appId);
        const notification: NotificationIntegrationToggleConfig = { enabled };
        if (appId !== undefined) notification.appId = appId;
        integrations.notification = notification;
      }
    }

    return { version, integrations };
  } catch {
    return undefined;
  }
}

export function areControlConfigsEqual(a: ControlConfig, b: ControlConfig): boolean {
  if (a.version !== b.version) return false;
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
      if (a.integrations.notification.enabled !== b.integrations.notification.enabled) return false;
      if (a.integrations.notification.appId !== b.integrations.notification.appId) return false;
    }
  }
  return true;
}
