import { describe, expect, it } from "vitest";

import { parseControlConfig } from "../src/config/schema";
import type { ControlConfig } from "../src/config/schema";

const expectedDefaults: ControlConfig = {
  version: 0,
  integrations: {
    onesignal: { enabled: false },
    gamification: { enabled: false },
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
        onesignal: { enabled: "true" as any },
      },
    });

    expect(parsed.version).toBe(3);
    expect(parsed.integrations).toEqual({
      onesignal: { enabled: false },
      gamification: { enabled: false },
    });
  });

  it("uses safe default version when `version` is invalid (NaN/string)", () => {
    const parsedNaN = parseControlConfig({
      version: Number.NaN,
      integrations: { onesignal: { enabled: true } },
    });
    expect(parsedNaN).toEqual({
      version: 0,
      integrations: {
        onesignal: { enabled: true },
        gamification: { enabled: false },
      },
    });

    const parsedString = parseControlConfig({
      version: "bad-version" as any,
      integrations: { onesignal: { enabled: true } },
    });
    expect(parsedString).toEqual(parsedNaN);
  });

  it("ignores unknown keys", () => {
    const parsed = parseControlConfig({
      version: 7,
      someUnknownTopLevelKey: "ignored",
      integrations: {
        onesignal: { enabled: true },
        someUnknownIntegrationKey: { enabled: true },
      } as any,
    });

    expect(parsed).toEqual({
      version: 7,
      integrations: {
        onesignal: { enabled: true },
        gamification: { enabled: false },
      },
    });
  });

  it("preserves allowed per-integration config fields for remote overrides", () => {
    const parsed = parseControlConfig({
      version: 2,
      integrations: {
        gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k_123" },
      },
    });

    expect(parsed).toEqual({
      version: 2,
      integrations: {
        gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k_123" },
        onesignal: { enabled: false },
      },
    });
  });

  it("ignores invalid gamification.packageVersion inputs", () => {
    const parsed = parseControlConfig({
      version: 1,
      integrations: {
        gamification: { enabled: true, packageVersion: "1.0.0/evil", apiKey: "k_123" },
      },
    });

    expect(parsed.integrations.gamification).toEqual({ enabled: true, apiKey: "k_123" });
  });
});
