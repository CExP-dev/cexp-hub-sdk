import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  CEXP_CUSTOM_EVENT_SCHEMA,
  CEXP_IDENTITY_CONTEXT_SCHEMA,
  SnowplowPlugin,
} from "../src/plugins/snowplow/SnowplowPlugin";
import type { IntegrationToggles } from "../src/types";

describe("SnowplowPlugin", () => {
  let toggles: IntegrationToggles;
  let snowplow: ReturnType<typeof vi.fn>;

  const ctx = {
    getToggles: () => toggles,
    getAnonymousId: () => "fpt-test-uuid",
    getUserId: () => null as string | null,
  };

  beforeEach(() => {
    toggles = {
      snowplow: true,
      onesignal: false,
      gamification: false,
      identity: false,
    };

    snowplow = vi.fn();

    const head = document.head;
    const originalAppend = head.appendChild.bind(head);
    vi.spyOn(head, "appendChild").mockImplementation((node: Node) => {
      if (node instanceof HTMLScriptElement && node.src.includes("cexp.fpt.com")) {
        queueMicrotask(() => {
          (globalThis as unknown as { snowplow: typeof snowplow }).snowplow = snowplow;
          node.dispatchEvent(new Event("load"));
        });
      }
      return originalAppend(node);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('script[src*="cexp.fpt.com"]').forEach((el) => el.remove());
    delete (globalThis as unknown as { snowplow?: unknown }).snowplow;
  });

  it("registers the tracker and activity tracking after enable", async () => {
    const plugin = new SnowplowPlugin();
    plugin.init(ctx, { appId: "app-x", collectorUrl: "https://collector.example" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(snowplow.mock.calls.some((c) => c[0] === "newTracker")).toBe(true);
    });

    expect(snowplow).toHaveBeenCalledWith(
      "newTracker",
      "sp1",
      "https://collector.example",
      expect.objectContaining({
        appId: "app-x",
        postPath: "/com.fpt/t",
        post: true,
      }),
    );

    expect(snowplow).toHaveBeenCalledWith("enableActivityTracking", {
      minimumVisitLength: 5,
      heartbeatDelay: 10,
    });
  });

  it("maps track() to trackSelfDescribingEvent with identity context", async () => {
    const plugin = new SnowplowPlugin();
    plugin.init(ctx, {});
    plugin.onToggle(true);

    await vi.waitFor(() => expect(snowplow.mock.calls.length).toBeGreaterThan(0));

    plugin.identify("user-1", { tier: "gold" });
    plugin.track("purchase", { amount: 9.99 });

    const trackCall = snowplow.mock.calls.find((c) => c[0] === "trackSelfDescribingEvent");
    expect(trackCall).toBeDefined();
    expect(trackCall?.[1]).toMatchObject({
      event: {
        schema: CEXP_CUSTOM_EVENT_SCHEMA,
        data: {
          event_name: "purchase",
          properties: { amount: 9.99 },
        },
      },
    });

    const ctxBlock = (trackCall?.[1] as { context?: Array<{ schema: string; data: Record<string, unknown> }> }).context?.[0];
    expect(ctxBlock?.schema).toBe(CEXP_IDENTITY_CONTEXT_SCHEMA);
    expect(ctxBlock?.data).toMatchObject({
      fpt_uuid: "fpt-test-uuid",
      userId: "user-1",
      traits: { tier: "gold" },
    });
  });

  it("maps page() to trackPageView with identity context", async () => {
    const plugin = new SnowplowPlugin();
    plugin.init(ctx, {});
    plugin.onToggle(true);

    await vi.waitFor(() => expect(snowplow.mock.calls.some((c) => c[0] === "newTracker")).toBe(true));

    plugin.page({ path: "/p", title: "T" });

    const pageCall = snowplow.mock.calls.find((c) => c[0] === "trackPageView");
    expect(pageCall).toBeDefined();
    expect(pageCall?.[1]).toMatchObject({
      path: "/p",
      title: "T",
    });
  });

  it("removes the script and attempts deleteTracker on toggle off", async () => {
    const plugin = new SnowplowPlugin();
    plugin.init(ctx, {});
    plugin.onToggle(true);

    await vi.waitFor(() => expect(snowplow.mock.calls.some((c) => c[0] === "newTracker")).toBe(true));

    plugin.onToggle(false);

    expect(snowplow).toHaveBeenCalledWith("deleteTracker", "sp1");
    expect(document.querySelector('script[src*="cexp.fpt.com"]')).toBeNull();
  });
});
