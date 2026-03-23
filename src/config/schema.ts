export type IntegrationKey = "snowplow" | "onesignal" | "gamification" | "identity";

export interface IntegrationToggleConfig {
  enabled: boolean;
}

export interface ControlConfig {
  version: number;
  integrations: Record<IntegrationKey, IntegrationToggleConfig>;
}

const INTEGRATION_KEYS: IntegrationKey[] = ["snowplow", "onesignal", "gamification", "identity"];

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

/**
 * Parse remote control JSON into a safe internal shape.
 * Never throws: it tolerates missing fields and ignores unknown keys.
 */
export function parseControlConfig(input: unknown): ControlConfig {
  const defaults: ControlConfig = {
    version: 0,
    integrations: {
      snowplow: { enabled: false },
      onesignal: { enabled: false },
      gamification: { enabled: false },
      identity: { enabled: false },
    },
  };

  if (!isRecord(input)) return defaults;

  const version =
    typeof input.version === "number" && Number.isFinite(input.version) ? input.version : defaults.version;

  const integrationsInput = isRecord(input.integrations) ? input.integrations : undefined;

  const integrations: ControlConfig["integrations"] = {
    snowplow: { enabled: false },
    onesignal: { enabled: false },
    gamification: { enabled: false },
    identity: { enabled: false },
  };

  for (const key of INTEGRATION_KEYS) {
    const block = integrationsInput?.[key];
    const enabled = isRecord(block) ? safeBoolean(block.enabled) : undefined;
    integrations[key] = { enabled: enabled ?? false };
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
      snowplow: { enabled: false },
      onesignal: { enabled: false },
      gamification: { enabled: false },
      identity: { enabled: false },
    };

    for (const key of INTEGRATION_KEYS) {
      const integrationsHasOwnKey = Object.prototype.hasOwnProperty.call(integrationsInput, key);
      if (!integrationsHasOwnKey) {
        integrations[key] = { enabled: false };
        continue;
      }

      const block = (integrationsInput as Record<string, unknown>)[key];
      if (!isPlainObject(block)) return undefined;

      const enabled = (block as Record<string, unknown>).enabled;
      if (typeof enabled !== "boolean") return undefined;
      integrations[key] = { enabled };
    }

    return { version, integrations };
  } catch {
    return undefined;
  }
}

export function areControlConfigsEqual(a: ControlConfig, b: ControlConfig): boolean {
  if (a.version !== b.version) return false;
  for (const key of INTEGRATION_KEYS) {
    if (a.integrations[key].enabled !== b.integrations[key].enabled) return false;
  }
  return true;
}

