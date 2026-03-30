import { describe, it, expect, vi } from "vitest";

import { Hub } from "../src/hub/Hub";
import type { ControlConfig } from "../src/config/schema";
import type { IntegrationToggles } from "../src/types";
import type { Plugin } from "../src/plugins/types";

describe("Hub plugin registry + lifecycle", () => {
  it("passes per-integration config to plugin.init and re-inits gamification on config change", async () => {
    const init = vi.fn();
    const onToggle = vi.fn();

    const gamificationPlugin: Plugin = {
      name: "gamification",
      init: (_ctx, config) => {
        init(config);
      },
      onToggle,
    };

    const hub = new Hub({
      pluginOverrides: { gamification: gamificationPlugin },
      anonymousId: "anon-1",
    });

    const c1: ControlConfig = {
      version: 1,
      integrations: {
        snowplow: { enabled: false },
        onesignal: { enabled: false },
        identity: { enabled: false },
        gamification: { enabled: true, packageVersion: "1.0.1-beta.9", apiKey: "k1" },
      },
    };

    const c2: ControlConfig = {
      version: 2,
      integrations: {
        snowplow: { enabled: false },
        onesignal: { enabled: false },
        identity: { enabled: false },
        gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k1" },
      },
    };

    await hub.setControlConfig(c1);
    await hub.setControlConfig(c2);

    expect(init.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(init.mock.calls[0]![0]).toMatchObject(c1.integrations.gamification);
    expect(init.mock.calls[1]![0]).toMatchObject(c2.integrations.gamification);

    // First sync: enabled -> onToggle(true)
    // Second sync: config changed while enabled -> onToggle(false) then onToggle(true)
    expect(onToggle.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
  });

  it("keeps ctx.getToggles live after subsequent hub.setControlConfig updates", async () => {
    let getTogglesFn: (() => IntegrationToggles) | undefined;
    const snowplowOnToggle = vi.fn();

    const snowplowPlugin: Plugin = {
      name: "snowplow",
      init: (ctx) => {
        // Capture the function reference during init. It must remain live and reflect later updates.
        getTogglesFn = ctx.getToggles;
      },
      onToggle: snowplowOnToggle,
    };

    const hub = new Hub({
      pluginOverrides: { snowplow: snowplowPlugin },
      anonymousId: "anon-1",
    });

    const c1: ControlConfig = {
      version: 1,
      integrations: {
        snowplow: { enabled: false },
        onesignal: { enabled: false },
        identity: { enabled: false },
        gamification: { enabled: false },
      },
    };

    const c2: ControlConfig = {
      version: 2,
      integrations: {
        snowplow: { enabled: true },
        onesignal: { enabled: false },
        identity: { enabled: false },
        gamification: { enabled: false },
      },
    };

    await hub.setControlConfig(c1);
    expect(getTogglesFn).toBeDefined();
    const fnRef = getTogglesFn!;
    expect(fnRef()).toEqual({
      snowplow: false,
      onesignal: false,
      gamification: false,
      identity: false,
    });

    await hub.setControlConfig(c2);
    expect(fnRef).toBe(getTogglesFn);
    expect(fnRef()).toEqual({
      snowplow: true,
      onesignal: false,
      gamification: false,
      identity: false,
    });
  });
});

