export type IntegrationKey = "snowplow" | "onesignal" | "gamification" | "identity";

export interface IntegrationToggleConfig {
  enabled: boolean;
}

export interface ControlConfig {
  version: number;
  integrations: Record<IntegrationKey, IntegrationToggleConfig>;
}

const INTEGRATION_KEYS: IntegrationKey[] = ["snowplow", "onesignal", "gamification", "identity"];

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

export function areControlConfigsEqual(a: ControlConfig, b: ControlConfig): boolean {
  if (a.version !== b.version) return false;
  for (const key of INTEGRATION_KEYS) {
    if (a.integrations[key].enabled !== b.integrations[key].enabled) return false;
  }
  return true;
}

