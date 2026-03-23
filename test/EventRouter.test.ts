import { describe, it, expect } from "vitest";

import { EventRouter } from "../src/hub/EventRouter";
import type { IntegrationToggles } from "../src/types";
import type { Plugin } from "../src/plugins/types";
import { SnowplowPlugin } from "../src/plugins/snowplow/SnowplowPlugin";

describe("EventRouter + Snowplow identify queue rules", () => {
  it("Snowplow off: drops track, queues identify", () => {
    let toggles: IntegrationToggles = {
      snowplow: false,
      onesignal: false,
      gamification: false,
      identity: false,
    };

    const ctx = {
      getToggles: () => toggles,
      getAnonymousId: () => "anon-1",
      getUserId: () => null,
    };

    const snowplow = new SnowplowPlugin();
    const plugins: Map<string, Plugin> = new Map([["snowplow", snowplow]]);

    const router = new EventRouter({ ctx, plugins });

    router.track("purchase", { amount: 10 });
    expect(snowplow.trackCalls).toHaveLength(0);

    router.identify("user-1", { plan: "pro" });
    expect(snowplow.identifyCalls).toHaveLength(0);

    const queue = (router as any).identifyQueue as Array<{ userId: string; traits?: Record<string, unknown> }>;
    expect(queue).toHaveLength(1);
    expect(queue[0].userId).toBe("user-1");
    expect(queue[0].traits).toEqual({ plan: "pro" });
  });

  it("Snowplow on: queued identify flushes before new track", () => {
    let toggles: IntegrationToggles = {
      snowplow: false,
      onesignal: false,
      gamification: false,
      identity: false,
    };

    const ctx = {
      getToggles: () => toggles,
      getAnonymousId: () => "anon-1",
      getUserId: () => null,
    };

    const snowplow = new SnowplowPlugin();
    const plugins: Map<string, Plugin> = new Map([["snowplow", snowplow]]);

    const router = new EventRouter({ ctx, plugins });

    router.identify("u1", { role: "x" });
    expect(snowplow.identifyCalls).toHaveLength(0);

    toggles = { ...toggles, snowplow: true };

    router.track("signup", { source: "ad" });

    expect(snowplow.identifyCalls).toHaveLength(1);
    expect(snowplow.trackCalls).toHaveLength(1);
    expect(snowplow.callSequence).toEqual(["identify:u1", "track:signup"]);

    const queue = (router as any).identifyQueue as Array<unknown>;
    expect(queue).toHaveLength(0);
  });
});

