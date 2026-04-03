export type IntegrationKey = "onesignal" | "gamification";

export interface BasicIntegrationToggleConfig {
  enabled: boolean;
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
}

export interface IntegrationToggleConfigByKey {
  onesignal: BasicIntegrationToggleConfig;
  gamification: GamificationIntegrationToggleConfig;
}

export interface ControlConfig {
  version: number;
  integrations: IntegrationToggleConfigByKey;
}

const INTEGRATION_KEYS: IntegrationKey[] = ["onesignal", "gamification"];

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
      onesignal: { enabled: false },
      gamification: { enabled: false },
    },
  };

  if (!isRecord(input)) return defaults;

  const version =
    typeof input.version === "number" && Number.isFinite(input.version) ? input.version : defaults.version;

  const integrationsInput = isRecord(input.integrations) ? input.integrations : undefined;

  const integrations: ControlConfig["integrations"] = {
    onesignal: { enabled: false },
    gamification: { enabled: false },
  };

  for (const key of INTEGRATION_KEYS) {
    const block = integrationsInput?.[key];
    const enabled = isRecord(block) ? safeBoolean(block.enabled) : undefined;
    if (key === "gamification") {
      const apiKey = isRecord(block) ? safeNonEmptyString(block.apiKey) : undefined;
      const packageVersion = isRecord(block) ? safePackageVersion(block.packageVersion) : undefined;

      const gamification: GamificationIntegrationToggleConfig = { enabled: enabled ?? false };
      if (apiKey !== undefined) gamification.apiKey = apiKey;
      if (packageVersion !== undefined) gamification.packageVersion = packageVersion;

      integrations.gamification = gamification;
    } else {
      const basic: BasicIntegrationToggleConfig = { enabled: enabled ?? false };
      integrations[key] = basic;
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
      onesignal: { enabled: false },
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

        const gamification: GamificationIntegrationToggleConfig = { enabled };
        if (apiKey !== undefined) gamification.apiKey = apiKey;
        if (packageVersion !== undefined) gamification.packageVersion = packageVersion;
        integrations.gamification = gamification;
      } else {
        const basic: BasicIntegrationToggleConfig = { enabled };
        integrations[key] = basic;
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
    } else {
      if (a.integrations[key].enabled !== b.integrations[key].enabled) return false;
    }
  }
  return true;
}
