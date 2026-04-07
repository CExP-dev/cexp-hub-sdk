import { describe, it, expect } from "vitest";

import { EventRouter } from "../src/hub/EventRouter";
import type { IntegrationToggles } from "../src/types";
import type { HubContext, Plugin } from "../src/plugins/types";

function createRecordingPlugin(name: string) {
  const identifyCalls: Array<{ userId: string; traits?: Record<string, unknown> }> = [];
  let resetCount = 0;

  const plugin: Plugin = {
    name,
    init: () => {},
    onToggle: () => {},
    identify: (userId, traits) => {
      identifyCalls.push({ userId, traits });
    },
    reset: () => {
      resetCount += 1;
    },
  };

  return { plugin, identifyCalls, get resetCount() { return resetCount; } };
}

function ctxWithToggles(getToggles: () => IntegrationToggles): HubContext {
  return {
    getToggles,
    getUserId: () => null,
  };
}

describe("EventRouter", () => {
  it("identify: forwards to notification when notification is on", () => {
    const toggles: IntegrationToggles = { notification: true, gamification: false };
    const { plugin: notification, identifyCalls: nIdentify } =
      createRecordingPlugin("notification");
    const { plugin: gamification, identifyCalls: gIdentify } =
      createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["notification", notification],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("u1", { plan: "pro" });

    expect(nIdentify).toEqual([{ userId: "u1", traits: { plan: "pro" } }]);
    expect(gIdentify).toHaveLength(0);
  });

  it("identify: forwards to gamification when gamification is on", () => {
    const toggles: IntegrationToggles = { notification: false, gamification: true };
    const { plugin: notification, identifyCalls: nIdentify } =
      createRecordingPlugin("notification");
    const { plugin: gamification, identifyCalls: gIdentify } =
      createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["notification", notification],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("u2", {});

    expect(nIdentify).toHaveLength(0);
    expect(gIdentify).toEqual([{ userId: "u2", traits: {} }]);
  });

  it("identify: calls both when notification and gamification are on", () => {
    const toggles: IntegrationToggles = { notification: true, gamification: true };
    const { plugin: notification, identifyCalls: nIdentify } =
      createRecordingPlugin("notification");
    const { plugin: gamification, identifyCalls: gIdentify } =
      createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["notification", notification],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("user-1", { plan: "pro" });

    expect(nIdentify).toEqual([{ userId: "user-1", traits: { plan: "pro" } }]);
    expect(gIdentify).toEqual([{ userId: "user-1", traits: { plan: "pro" } }]);
  });

  it("reset: calls only notification (gamification has no reset)", () => {
    const toggles: IntegrationToggles = { notification: true, gamification: true };
    const nRec = createRecordingPlugin("notification");
    const gamRec = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["notification", nRec.plugin],
      ["gamification", gamRec.plugin],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.reset();

    expect(nRec.resetCount).toBe(1);
    expect(gamRec.resetCount).toBe(0);
  });
});
