import { describe, it, expect } from "vitest";

import { EventRouter } from "../src/hub/EventRouter";
import type { IntegrationToggles } from "../src/types";
import type { HubContext, Plugin } from "../src/plugins/types";

function createRecordingPlugin(name: "onesignal" | "gamification") {
  const identifyCalls: Array<{ userId: string; traits?: Record<string, unknown> }> = [];
  const trackCalls: Array<{ event: string; props: Record<string, unknown> }> = [];
  const pageCalls: Array<{ props: Record<string, unknown> }> = [];
  let resetCount = 0;

  const plugin: Plugin = {
    name,
    init: () => {},
    onToggle: () => {},
    identify: (userId, traits) => {
      identifyCalls.push({ userId, traits });
    },
    track: (event, props) => {
      trackCalls.push({ event, props });
    },
    page: (props) => {
      pageCalls.push({ props });
    },
    reset: () => {
      resetCount += 1;
    },
  };

  return { plugin, identifyCalls, trackCalls, pageCalls, get resetCount() {
    return resetCount;
  } };
}

function ctxWithToggles(getToggles: () => IntegrationToggles): HubContext {
  return {
    getToggles,
    getUserId: () => null,
  };
}

describe("EventRouter", () => {
  it("track: gamification off does not call gamification.track", () => {
    const toggles: IntegrationToggles = { onesignal: false, gamification: false };
    const { plugin: gamification, trackCalls } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", createRecordingPlugin("onesignal").plugin],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.track("purchase", { amount: 10 });

    expect(trackCalls).toHaveLength(0);
  });

  it("track: gamification on forwards to gamification.track", () => {
    const toggles: IntegrationToggles = { onesignal: false, gamification: true };
    const { plugin: gamification, trackCalls } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", createRecordingPlugin("onesignal").plugin],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.track("signup", { source: "ad" });

    expect(trackCalls).toEqual([{ event: "signup", props: { source: "ad" } }]);
  });

  it("page: gamification off does not call gamification.page", () => {
    const toggles: IntegrationToggles = { onesignal: false, gamification: false };
    const { plugin: gamification, pageCalls } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([["gamification", gamification]]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.page({ path: "/x" });

    expect(pageCalls).toHaveLength(0);
  });

  it("page: gamification on forwards to gamification.page", () => {
    const toggles: IntegrationToggles = { onesignal: false, gamification: true };
    const { plugin: gamification, pageCalls } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([["gamification", gamification]]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.page({ path: "/p" });

    expect(pageCalls).toEqual([{ props: { path: "/p" } }]);
  });

  it("identify: forwards to OneSignal when onesignal is on", () => {
    const toggles: IntegrationToggles = { onesignal: true, gamification: false };
    const { plugin: onesignal, identifyCalls: osIdentify } = createRecordingPlugin("onesignal");
    const { plugin: gamification, identifyCalls: gIdentify } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", onesignal],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("u1", { plan: "pro" });

    expect(osIdentify).toEqual([{ userId: "u1", traits: { plan: "pro" } }]);
    expect(gIdentify).toHaveLength(0);
  });

  it("identify: forwards to gamification when gamification is on", () => {
    const toggles: IntegrationToggles = { onesignal: false, gamification: true };
    const { plugin: onesignal, identifyCalls: osIdentify } = createRecordingPlugin("onesignal");
    const { plugin: gamification, identifyCalls: gIdentify } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", onesignal],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("u2", {});

    expect(osIdentify).toHaveLength(0);
    expect(gIdentify).toEqual([{ userId: "u2", traits: {} }]);
  });

  it("identify: calls both when onesignal and gamification are on", () => {
    const toggles: IntegrationToggles = { onesignal: true, gamification: true };
    const { plugin: onesignal, identifyCalls: osIdentify } = createRecordingPlugin("onesignal");
    const { plugin: gamification, identifyCalls: gIdentify } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", onesignal],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("user-1", { plan: "pro" });

    expect(osIdentify).toEqual([{ userId: "user-1", traits: { plan: "pro" } }]);
    expect(gIdentify).toEqual([{ userId: "user-1", traits: { plan: "pro" } }]);
  });

  it("reset: calls enabled plugins only", () => {
    const toggles: IntegrationToggles = { onesignal: true, gamification: false };
    const osRec = createRecordingPlugin("onesignal");
    const gamRec = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", osRec.plugin],
      ["gamification", gamRec.plugin],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.reset();

    expect(osRec.resetCount).toBe(1);
    expect(gamRec.resetCount).toBe(0);
  });
});
