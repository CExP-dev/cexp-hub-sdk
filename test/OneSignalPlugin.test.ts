import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

import { OneSignalPlugin } from "../src/plugins/onesignal/OneSignalPlugin";

const ONESIGNAL_SCRIPT_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

function hubCtx(overrides?: { getUserId?: () => string | null }) {
  return {
    getToggles: () => ({
      snowplow: false,
      onesignal: true,
      gamification: false,
      identity: false,
    }),
    getAnonymousId: () => null,
    getUserId: overrides?.getUserId ?? (() => null),
  };
}

const origHeadAppendChild = HTMLHeadElement.prototype.appendChild;

/** Appends for real so `querySelector` works; fires `onload` like a browser. */
function mockHeadAppendChildWithScriptLoad(): MockInstance<(node: Node) => HTMLScriptElement> {
  return vi.spyOn(document.head, "appendChild").mockImplementation(function (this: HTMLHeadElement, node: Node) {
    const el = node as HTMLScriptElement;
    if (el?.tagName === "SCRIPT" && el.onload) {
      queueMicrotask(() => el.onload?.(new Event("load")));
    }
    return origHeadAppendChild.call(this, node) as HTMLScriptElement;
  });
}

async function drainOneSignalDeferred(
  oneSignal: { init: ReturnType<typeof vi.fn>; login?: ReturnType<typeof vi.fn>; logout?: ReturnType<typeof vi.fn> },
) {
  const w = window as unknown as { OneSignalDeferred?: Array<(os: typeof oneSignal) => void | Promise<void>> };
  const q = w.OneSignalDeferred ? [...w.OneSignalDeferred] : [];
  for (const fn of q) {
    await fn(oneSignal);
  }
}

describe("OneSignalPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll(`script[src="${ONESIGNAL_SCRIPT_URL}"]`).forEach((n) => n.remove());
    delete (window as unknown as { OneSignalDeferred?: unknown }).OneSignalDeferred;
    delete (window as unknown as { OneSignal?: unknown }).OneSignal;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects OneSignal script and queues init with appId from config", async () => {
    const appendSpy = mockHeadAppendChildWithScriptLoad();

    const plugin = new OneSignalPlugin();
    plugin.init(hubCtx(), { appId: "app-123" });

    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(appendSpy).toHaveBeenCalled();
    });

    const mockOs = {
      init: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await drainOneSignalDeferred(mockOs);

    expect(mockOs.init).toHaveBeenCalledWith({ appId: "app-123" });
  });

  it("calls login when identify runs after init", async () => {
    mockHeadAppendChildWithScriptLoad();

    const plugin = new OneSignalPlugin();
    plugin.init(hubCtx(), { appId: "app-xyz" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${ONESIGNAL_SCRIPT_URL}"]`)).toBeTruthy();
    });

    const mockOs = {
      init: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await drainOneSignalDeferred(mockOs);

    plugin.identify("user-42");

    expect(mockOs.login).toHaveBeenCalledWith("user-42");
  });

  it("associates pending user after init when identify was called first", async () => {
    mockHeadAppendChildWithScriptLoad();

    const plugin = new OneSignalPlugin();
    plugin.init(hubCtx(), { appId: "app-early" });
    plugin.onToggle(true);

    plugin.identify("early-user");

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${ONESIGNAL_SCRIPT_URL}"]`)).toBeTruthy();
    });

    const mockOs = {
      init: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await drainOneSignalDeferred(mockOs);

    expect(mockOs.login).toHaveBeenCalledWith("early-user");
  });

  it("on toggle-off calls logout, removes script, and clears OneSignal globals", async () => {
    mockHeadAppendChildWithScriptLoad();

    const plugin = new OneSignalPlugin();
    plugin.init(hubCtx(), { appId: "app-off" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${ONESIGNAL_SCRIPT_URL}"]`)).toBeTruthy();
    });

    const mockOs = {
      init: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await drainOneSignalDeferred(mockOs);

    plugin.onToggle(false);

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${ONESIGNAL_SCRIPT_URL}"]`)).toBeNull();
    });

    expect(mockOs.logout).toHaveBeenCalled();
    expect((window as unknown as { OneSignalDeferred?: unknown }).OneSignalDeferred).toBeUndefined();
    expect((window as unknown as { OneSignal?: unknown }).OneSignal).toBeUndefined();
  });

  it("reset triggers logout when OneSignal is active", async () => {
    mockHeadAppendChildWithScriptLoad();

    const plugin = new OneSignalPlugin();
    plugin.init(hubCtx(), { appId: "app-reset" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${ONESIGNAL_SCRIPT_URL}"]`)).toBeTruthy();
    });

    const mockOs = {
      init: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    await drainOneSignalDeferred(mockOs);

    plugin.reset();

    expect(mockOs.logout).toHaveBeenCalled();
  });

  it("does not inject script when appId is missing", async () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");

    const plugin = new OneSignalPlugin();
    plugin.init(hubCtx(), {});
    plugin.onToggle(true);

    await Promise.resolve();

    expect(appendSpy).not.toHaveBeenCalled();
  });
});
