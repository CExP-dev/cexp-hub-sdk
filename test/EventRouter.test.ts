import { describe, it, expect, vi } from "vitest";

import { EventRouter, IDENTIFY_QUEUE_MAX_SIZE, IDENTIFY_QUEUE_TTL_MS } from "../src/hub/EventRouter";
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

    // Enabling Snowplow should flush queued identifies before any live events.
    toggles = { ...toggles, snowplow: true };
    router.track("signup", { source: "ad" });

    expect(snowplow.identifyCalls).toHaveLength(1);
    expect(snowplow.trackCalls).toHaveLength(1);
    expect(snowplow.identifyCalls[0].userId).toBe("user-1");
    expect(snowplow.identifyCalls[0].traits).toEqual({ plan: "pro" });
    expect(snowplow.callSequence).toEqual(["identify:user-1", "track:signup"]);
  });

  it("Multi-entry FIFO: queued identifies flush in enqueue order before live events", () => {
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
    router.identify("u2", { role: "y" });
    router.identify("u3", { role: "z" });
    expect(snowplow.identifyCalls).toHaveLength(0);

    toggles = { ...toggles, snowplow: true };
    router.track("signup", { source: "ad" });

    expect(snowplow.identifyCalls).toHaveLength(3);
    expect(snowplow.trackCalls).toHaveLength(1);
    expect(snowplow.callSequence).toEqual(["identify:u1", "identify:u2", "identify:u3", "track:signup"]);
  });

  it(`IDENTIFY_QUEUE_MAX_SIZE: max enforces bounded queue while Snowplow is off`, () => {
    const queuedCount = IDENTIFY_QUEUE_MAX_SIZE + 7;

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

    for (let i = 0; i < queuedCount; i++) {
      router.identify(`u${i}`, { plan: i });
    }

    expect(snowplow.identifyCalls).toHaveLength(0);
    expect(snowplow.callSequence).toHaveLength(0);

    toggles = { ...toggles, snowplow: true };
    router.track("signup", { source: "ad" });

    const overflow = queuedCount - IDENTIFY_QUEUE_MAX_SIZE;
    const forwardedUsers = Array.from({ length: IDENTIFY_QUEUE_MAX_SIZE }, (_, i) => `u${overflow + i}`);

    expect(snowplow.identifyCalls).toHaveLength(IDENTIFY_QUEUE_MAX_SIZE);
    expect(snowplow.identifyCalls.map((c) => c.userId)).toEqual(forwardedUsers);
    expect(snowplow.callSequence).toEqual([...forwardedUsers.map((u) => `identify:${u}`), "track:signup"]);
  });

  it(`IDENTIFY_QUEUE_TTL_MS: expired queued identifies are pruned at flush time`, () => {
    vi.useFakeTimers();

    try {
      const t0 = 1_700_000_000_000; // fixed "now" for deterministic TTL math

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

      // Enqueue "old" at t0
      vi.setSystemTime(t0);
      router.identify("old", { plan: "old" });

      // Enqueue "fresh" just before the TTL cutoff (still within TTL)
      vi.setSystemTime(t0 + IDENTIFY_QUEUE_TTL_MS - 1);
      router.identify("fresh", { plan: "fresh" });

      // Flush after TTL has passed; "old" should be dropped, "fresh" forwarded.
      vi.setSystemTime(t0 + IDENTIFY_QUEUE_TTL_MS + 10);
      toggles = { ...toggles, snowplow: true };
      router.track("signup", { source: "ad" });

      expect(snowplow.identifyCalls).toHaveLength(1);
      expect(snowplow.identifyCalls[0].userId).toBe("fresh");
      expect(snowplow.identifyCalls[0].traits).toEqual({ plan: "fresh" });
      expect(snowplow.callSequence).toEqual(["identify:fresh", "track:signup"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

