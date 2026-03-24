import { describe, it, expect, vi } from "vitest";

import { EventRouter, IDENTIFY_QUEUE_MAX_SIZE, IDENTIFY_QUEUE_TTL_MS } from "../src/hub/EventRouter";
import type { IntegrationToggles } from "../src/types";
import type { Plugin } from "../src/plugins/types";

function createRecordingSnowplowPlugin() {
  const identifyCalls: Array<{ userId: string; traits?: Record<string, unknown> }> = [];
  const trackCalls: Array<{ event: string; props: Record<string, unknown> }> = [];
  const pageCalls: Array<{ props: Record<string, unknown> }> = [];
  const callSequence: string[] = [];

  const plugin: Plugin = {
    name: "snowplow",
    init: () => {},
    onToggle: () => {},
    identify: (userId, traits) => {
      identifyCalls.push({ userId, traits });
      callSequence.push(`identify:${userId}`);
    },
    track: (event, props) => {
      trackCalls.push({ event, props });
      callSequence.push(`track:${event}`);
    },
    page: (props) => {
      pageCalls.push({ props });
      callSequence.push(`page:${pageCalls.length}`);
    },
  };

  return { plugin, identifyCalls, trackCalls, pageCalls, callSequence };
}

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

    const { plugin: snowplow, identifyCalls, trackCalls, callSequence } = createRecordingSnowplowPlugin();
    const plugins: Map<string, Plugin> = new Map([["snowplow", snowplow]]);

    const router = new EventRouter({ ctx, plugins });

    router.track("purchase", { amount: 10 });
    expect(trackCalls).toHaveLength(0);

    router.identify("user-1", { plan: "pro" });
    expect(identifyCalls).toHaveLength(0);

    // Enabling Snowplow should flush queued identifies before any live events.
    toggles = { ...toggles, snowplow: true };
    router.track("signup", { source: "ad" });

    expect(identifyCalls).toHaveLength(1);
    expect(trackCalls).toHaveLength(1);
    expect(identifyCalls[0].userId).toBe("user-1");
    expect(identifyCalls[0].traits).toEqual({ plan: "pro" });
    expect(callSequence).toEqual(["identify:user-1", "track:signup"]);
  });

  it("Snowplow on: flush queued identifies before live identify", () => {
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

    const { plugin: snowplow, identifyCalls, callSequence } = createRecordingSnowplowPlugin();
    const plugins: Map<string, Plugin> = new Map([["snowplow", snowplow]]);
    const router = new EventRouter({ ctx, plugins });

    router.identify("queued-user", { plan: "queued" });
    expect(identifyCalls).toHaveLength(0);

    // Enable Snowplow: calling `identify()` should flush queued identifies first,
    // then perform the live identify.
    toggles = { ...toggles, snowplow: true };
    router.identify("live-user", { plan: "live" });

    expect(identifyCalls).toHaveLength(2);
    expect(identifyCalls[0].userId).toBe("queued-user");
    expect(identifyCalls[0].traits).toEqual({ plan: "queued" });
    expect(identifyCalls[1].userId).toBe("live-user");
    expect(identifyCalls[1].traits).toEqual({ plan: "live" });
    expect(callSequence).toEqual(["identify:queued-user", "identify:live-user"]);
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

    const { plugin: snowplow, identifyCalls, trackCalls, callSequence } = createRecordingSnowplowPlugin();
    const plugins: Map<string, Plugin> = new Map([["snowplow", snowplow]]);
    const router = new EventRouter({ ctx, plugins });

    router.identify("u1", { role: "x" });
    router.identify("u2", { role: "y" });
    router.identify("u3", { role: "z" });
    expect(identifyCalls).toHaveLength(0);

    toggles = { ...toggles, snowplow: true };
    router.track("signup", { source: "ad" });

    expect(identifyCalls).toHaveLength(3);
    expect(trackCalls).toHaveLength(1);
    expect(callSequence).toEqual(["identify:u1", "identify:u2", "identify:u3", "track:signup"]);
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

    const { plugin: snowplow, identifyCalls, callSequence } = createRecordingSnowplowPlugin();
    const plugins: Map<string, Plugin> = new Map([["snowplow", snowplow]]);
    const router = new EventRouter({ ctx, plugins });

    for (let i = 0; i < queuedCount; i++) {
      router.identify(`u${i}`, { plan: i });
    }

    expect(identifyCalls).toHaveLength(0);
    expect(callSequence).toHaveLength(0);

    toggles = { ...toggles, snowplow: true };
    router.track("signup", { source: "ad" });

    const overflow = queuedCount - IDENTIFY_QUEUE_MAX_SIZE;
    const forwardedUsers = Array.from({ length: IDENTIFY_QUEUE_MAX_SIZE }, (_, i) => `u${overflow + i}`);

    expect(identifyCalls).toHaveLength(IDENTIFY_QUEUE_MAX_SIZE);
    expect(identifyCalls.map((c) => c.userId)).toEqual(forwardedUsers);
    expect(callSequence).toEqual([...forwardedUsers.map((u) => `identify:${u}`), "track:signup"]);
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

      const { plugin: snowplow, identifyCalls, callSequence } = createRecordingSnowplowPlugin();
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

      expect(identifyCalls).toHaveLength(1);
      expect(identifyCalls[0].userId).toBe("fresh");
      expect(identifyCalls[0].traits).toEqual({ plan: "fresh" });
      expect(callSequence).toEqual(["identify:fresh", "track:signup"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

