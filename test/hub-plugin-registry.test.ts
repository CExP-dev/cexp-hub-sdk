import { describe, it, expect, vi } from "vitest";

import { Hub } from "../src/hub/Hub";
import type { IntegrationToggles } from "../src/types";
import type { Plugin } from "../src/plugins/types";

describe("Hub plugin registry + lifecycle", () => {
  it("calls plugin.onToggle(false) then plugin.onToggle(true) on toggle changes", () => {
    const onToggle = vi.fn();
    const init = vi.fn();

    const snowplowPlugin: Plugin = {
      name: "snowplow",
      init: () => {
        init();
      },
      onToggle,
    };

    const hub = new Hub({
      pluginOverrides: { snowplow: snowplowPlugin },
      anonymousId: "anon-1",
    });

    const disabled: IntegrationToggles = {
      snowplow: false,
      onesignal: false,
      gamification: false,
      identity: false,
    };

    const enabled: IntegrationToggles = {
      ...disabled,
      snowplow: true,
    };

    hub.setToggles(disabled);
    hub.setToggles(enabled);

    expect(onToggle.mock.calls).toEqual([[false], [true]]);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("keeps ctx.getToggles live after subsequent hub.setToggles updates", () => {
    let getTogglesFn: (() => IntegrationToggles) | undefined;

    const snowplowPlugin: Plugin = {
      name: "snowplow",
      init: (ctx) => {
        // Capture the function reference during init. It must remain live and reflect later updates.
        getTogglesFn = ctx.getToggles;
      },
      onToggle: vi.fn(),
    };

    const hub = new Hub({
      pluginOverrides: { snowplow: snowplowPlugin },
      anonymousId: "anon-1",
    });

    const disabled: IntegrationToggles = {
      snowplow: false,
      onesignal: false,
      gamification: false,
      identity: false,
    };

    const enabled: IntegrationToggles = {
      ...disabled,
      snowplow: true,
    };

    hub.setToggles(disabled);
    hub.setToggles(enabled);

    expect(getTogglesFn).toBeDefined();
    expect(getTogglesFn!()).toEqual(enabled);
  });
});

