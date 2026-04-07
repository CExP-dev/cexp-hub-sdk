import { describe, expect, it } from "vitest";

import {
  areControlConfigsEqual,
  parseControlConfig,
  tryParseControlConfig,
} from "../src/config/schema";
import type { ControlConfig } from "../src/config/schema";

const expectedDefaults: ControlConfig = {
  version: 0,
  integrations: {
    notification: { enabled: false },
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
        notification: { enabled: "true" as any },
      },
    });

    expect(parsed.version).toBe(3);
    expect(parsed.integrations).toEqual({
      notification: { enabled: false },
      gamification: { enabled: false },
    });
  });

  it("uses safe default version when `version` is invalid (NaN/string)", () => {
    const parsedNaN = parseControlConfig({
      version: Number.NaN,
      integrations: { notification: { enabled: true } },
    });
    expect(parsedNaN).toEqual({
      version: 0,
      integrations: {
        notification: { enabled: true },
        gamification: { enabled: false },
      },
    });

    const parsedString = parseControlConfig({
      version: "bad-version" as any,
      integrations: { notification: { enabled: true } },
    });
    expect(parsedString).toEqual(parsedNaN);
  });

  it("ignores unknown keys", () => {
    const parsed = parseControlConfig({
      version: 7,
      someUnknownTopLevelKey: "ignored",
      integrations: {
        notification: { enabled: true },
        someUnknownIntegrationKey: { enabled: true },
      } as any,
    });

    expect(parsed).toEqual({
      version: 7,
      integrations: {
        notification: { enabled: true },
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
        notification: { enabled: false },
      },
    });
  });

  it("preserves notification.appId when present", () => {
    const parsed = parseControlConfig({
      version: 3,
      integrations: {
        notification: { enabled: true, appId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      },
    });

    expect(parsed.integrations.notification).toEqual({
      enabled: true,
      appId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
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

  it("preserves valid gamification clientKey and tokenBaseUrl", () => {
    const parsed = parseControlConfig({
      version: 4,
      integrations: {
        gamification: {
          enabled: true,
          clientKey: " ck_abc ",
          tokenBaseUrl: "https://staging-cexp.cads.live/gamification/",
          apiKey: "k_static",
        },
      },
    });

    expect(parsed.integrations.gamification).toEqual({
      enabled: true,
      clientKey: "ck_abc",
      tokenBaseUrl: "https://staging-cexp.cads.live/gamification",
      apiKey: "k_static",
    });
  });

  it("drops invalid gamification.tokenBaseUrl but keeps other fields", () => {
    const parsed = parseControlConfig({
      version: 1,
      integrations: {
        gamification: {
          enabled: true,
          apiKey: "k_123",
          tokenBaseUrl: "http://staging-cexp.cads.live/gamification",
          clientKey: "ck",
        },
      },
    });

    expect(parsed.integrations.gamification).toEqual({
      enabled: true,
      apiKey: "k_123",
      clientKey: "ck",
    });
  });

  it("preserves apiKey-only gamification configs when CDP fields are absent", () => {
    const parsed = parseControlConfig({
      version: 2,
      integrations: {
        gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k_123" },
      },
    });

    expect(parsed.integrations.gamification).toEqual({
      enabled: true,
      packageVersion: "1.0.1-beta.10",
      apiKey: "k_123",
    });
  });

  it("tryParseControlConfig preserves sanitized gamification token fields", () => {
    const parsed = tryParseControlConfig({
      version: 1,
      integrations: {
        gamification: {
          enabled: true,
          clientKey: "ck",
          tokenBaseUrl: "https://prod-cexp.cads.live/gamification",
        },
      },
    });

    expect(parsed?.integrations.gamification).toEqual({
      enabled: true,
      clientKey: "ck",
      tokenBaseUrl: "https://prod-cexp.cads.live/gamification",
    });
  });

  it("areControlConfigsEqual compares clientKey and tokenBaseUrl", () => {
    const a: ControlConfig = {
      version: 1,
      integrations: {
        notification: { enabled: false },
        gamification: {
          enabled: true,
          clientKey: "a",
          tokenBaseUrl: "https://x.cads.live/gamification",
        },
      },
    };
    const b: ControlConfig = {
      ...a,
      integrations: {
        ...a.integrations,
        gamification: {
          ...a.integrations.gamification,
          tokenBaseUrl: "https://y.cads.live/gamification",
        },
      },
    };
    expect(areControlConfigsEqual(a, b)).toBe(false);
  });
});
