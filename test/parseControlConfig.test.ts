import { describe, expect, it } from "vitest";

import { parseControlConfig } from "../src/config/schema";
import type { ControlConfig } from "../src/config/schema";

const expectedDefaults: ControlConfig = {
  version: 0,
  integrations: {
    snowplow: { enabled: false },
    onesignal: { enabled: false },
    gamification: { enabled: false },
    identity: { enabled: false },
  },
};

describe("parseControlConfig schema safety", () => {
  it("never throws on non-object input and returns safe defaults", () => {
    expect(() => parseControlConfig(null)).not.toThrow();
    expect(parseControlConfig(null)).toEqual(expectedDefaults);

    expect(() => parseControlConfig(123 as any)).not.toThrow();
    expect(parseControlConfig(123 as any)).toEqual(expectedDefaults);

    expect(() => parseControlConfig("abc" as any)).not.toThrow();
    expect(parseControlConfig("abc" as any)).toEqual(expectedDefaults);
  });

  it("returns safe defaults when `integrations` is missing", () => {
    const parsed = parseControlConfig({ version: 5 });
    expect(parsed).toEqual({
      version: 5,
      integrations: expectedDefaults.integrations,
    });
  });

  it("returns safe defaults when `integrations` is not an object", () => {
    const parsed = parseControlConfig({ version: 2, integrations: "nope" as any });
    expect(parsed).toEqual({
      version: 2,
      integrations: expectedDefaults.integrations,
    });
  });

  it("treats non-boolean toggle values as disabled", () => {
    const parsed = parseControlConfig({
      version: 3,
      integrations: {
        snowplow: { enabled: "true" as any },
      },
    });

    expect(parsed.version).toBe(3);
    expect(parsed.integrations).toEqual({
      snowplow: { enabled: false },
      onesignal: { enabled: false },
      gamification: { enabled: false },
      identity: { enabled: false },
    });
  });

  it("uses safe default version when `version` is invalid (NaN/string)", () => {
    const parsedNaN = parseControlConfig({
      version: Number.NaN,
      integrations: { snowplow: { enabled: true } },
    });
    expect(parsedNaN).toEqual({
      version: 0,
      integrations: {
        snowplow: { enabled: true },
        onesignal: { enabled: false },
        gamification: { enabled: false },
        identity: { enabled: false },
      },
    });

    const parsedString = parseControlConfig({
      version: "bad-version" as any,
      integrations: { snowplow: { enabled: true } },
    });
    expect(parsedString).toEqual(parsedNaN);
  });

  it("ignores unknown keys", () => {
    const parsed = parseControlConfig({
      version: 7,
      someUnknownTopLevelKey: "ignored",
      integrations: {
        snowplow: { enabled: true },
        someUnknownIntegrationKey: { enabled: true },
      } as any,
    });

    expect(parsed).toEqual({
      version: 7,
      integrations: {
        snowplow: { enabled: true },
        onesignal: { enabled: false },
        gamification: { enabled: false },
        identity: { enabled: false },
      },
    });
  });

  it("preserves allowed per-integration config fields for remote overrides", () => {
    const parsed = parseControlConfig({
      version: 2,
      integrations: {
        gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k_123" },
        identity: { enabled: false },
      },
    });

    expect(parsed).toEqual({
      version: 2,
      integrations: {
        gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k_123" },
        snowplow: { enabled: false },
        onesignal: { enabled: false },
        identity: { enabled: false },
      },
    });
  });

  it("ignores invalid gamification.packageVersion inputs", () => {
    const parsed = parseControlConfig({
      version: 1,
      integrations: {
        gamification: { enabled: true, packageVersion: "1.0.0/evil", apiKey: "k_123" },
        identity: { enabled: false },
      },
    });

    expect(parsed.integrations.gamification).toEqual({ enabled: true, apiKey: "k_123" });
  });
});

