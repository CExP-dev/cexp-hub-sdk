import { describe, expect, it } from "vitest";

import { areControlConfigsEqual, tryParseControlConfig } from "../src/config/schema";
import type { ControlConfig } from "../src/config/schema";

describe("tryParseControlConfig (unified wire)", () => {
  it("returns undefined for non-plain-object roots", () => {
    expect(tryParseControlConfig(null)).toBeUndefined();
    expect(tryParseControlConfig(undefined)).toBeUndefined();
    expect(tryParseControlConfig(123)).toBeUndefined();
    expect(tryParseControlConfig("x")).toBeUndefined();
  });

  it("returns undefined when version or modules are invalid", () => {
    expect(tryParseControlConfig({})).toBeUndefined();
    expect(tryParseControlConfig({ version: "" })).toBeUndefined();
    expect(tryParseControlConfig({ version: "1" })).toBeUndefined();
    expect(tryParseControlConfig({ version: "1", modules: {} })).toBeUndefined();
  });

  it("parses minimal valid payload with empty modules", () => {
    expect(tryParseControlConfig({ version: "1", modules: [] })).toEqual({
      version: "1",
      integrations: {
        notification: { enabled: false },
        gamification: { enabled: false },
      },
    });
  });

  it("coerces numeric version to string", () => {
    expect(tryParseControlConfig({ version: 1, modules: [] })).toEqual({
      version: "1",
      integrations: {
        notification: { enabled: false },
        gamification: { enabled: false },
      },
    });
  });

  it("stores sdkId when non-empty trimmed string", () => {
    expect(tryParseControlConfig({ version: "1", sdkId: " abc ", modules: [] })).toEqual({
      version: "1",
      sdkId: "abc",
      integrations: {
        notification: { enabled: false },
        gamification: { enabled: false },
      },
    });
  });

  it("uses first NOTIFICATION module only", () => {
    const parsed = tryParseControlConfig({
      version: "2",
      modules: [
        { id: "a", type: "NOTIFICATION", property: { appId: "11111111-1111-1111-1111-111111111111" } },
        { id: "b", type: "NOTIFICATION", property: { appId: "22222222-2222-2222-2222-222222222222" } },
      ],
    });
    expect(parsed?.integrations.notification).toEqual({
      enabled: true,
      appId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("disables notification only when NOTIFICATION property is invalid; gamification still parses", () => {
    const parsed = tryParseControlConfig({
      version: "1",
      modules: [
        { id: "n", type: "NOTIFICATION", property: "not-an-object" },
        {
          id: "g",
          type: "GAMIFICATION",
          property: {
            packageVersion: "1.0.1-beta.10",
            apiKey: "k_123",
            clientKey: " ck_abc ",
            tokenBaseUrl: "https://staging-cexp.cads.live/gamification/",
          },
        },
      ],
    });
    expect(parsed?.integrations.notification).toEqual({ enabled: false });
    expect(parsed?.integrations.gamification).toEqual({
      enabled: true,
      packageVersion: "1.0.1-beta.10",
      apiKey: "k_123",
      clientKey: "ck_abc",
      tokenBaseUrl: "https://staging-cexp.cads.live/gamification",
    });
  });

  it("treats missing module property as empty object (integration on)", () => {
    const parsed = tryParseControlConfig({
      version: "1",
      modules: [{ id: "n", type: "NOTIFICATION" }],
    });
    expect(parsed?.integrations.notification).toEqual({ enabled: true });
  });

  it("sanitizes gamification token fields", () => {
    const parsed = tryParseControlConfig({
      version: "1",
      modules: [
        {
          type: "GAMIFICATION",
          property: {
            packageVersion: "1.0.0/evil",
            apiKey: "k_123",
            tokenBaseUrl: "http://staging-cexp.cads.live/gamification",
            clientKey: "ck",
          },
        },
      ],
    });
    expect(parsed?.integrations.gamification).toEqual({
      enabled: true,
      apiKey: "k_123",
      clientKey: "ck",
    });
  });

  it("preserves gamification.packageVersion with leading @", () => {
    const parsed = tryParseControlConfig({
      version: "1",
      modules: [
        {
          type: "GAMIFICATION",
          property: { packageVersion: "@1.0.1-test.0", apiKey: "k_123" },
        },
      ],
    });
    expect(parsed?.integrations.gamification).toEqual({
      enabled: true,
      packageVersion: "@1.0.1-test.0",
      apiKey: "k_123",
    });
  });

  it("coerces string delays in notification property for internal config", () => {
    const parsed = tryParseControlConfig({
      version: "1",
      modules: [
        {
          type: "NOTIFICATION",
          property: {
            promptOptions: {
              slidedown: {
                prompts: [{ delay: { pageViews: "2", timeDelay: "4" } }],
              },
            },
          },
        },
      ],
    });
    const po = parsed?.integrations.notification.promptOptions as {
      slidedown: { prompts: Array<{ delay: { pageViews: number; timeDelay: number } }> };
    };
    expect(po.slidedown.prompts[0].delay.pageViews).toBe(2);
    expect(po.slidedown.prompts[0].delay.timeDelay).toBe(4);
  });

  it("areControlConfigsEqual compares clientKey and tokenBaseUrl", () => {
    const a: ControlConfig = {
      version: "1",
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
