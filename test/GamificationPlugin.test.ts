import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

import {
  GamificationPlugin,
} from "../src/plugins/gamification/GamificationPlugin";

const DEFAULT_VER = "1.0.1-beta.9";
const scriptUrlForVersion = (v: string) =>
  `https://cdn.jsdelivr.net/npm/cexp-gamification@${v}/dist/cexp-web-sdk.js`;

function hubCtx() {
  return {
    getToggles: () => ({
      snowplow: false,
      onesignal: false,
      gamification: true,
      identity: false,
    }),
    getAnonymousId: () => null,
    getUserId: () => null,
  };
}

const origHeadAppendChild = HTMLHeadElement.prototype.appendChild;

/** Real append + synthetic load; call `beforeOnload` to assign `window.cexp` before the plugin's handler runs. */
function mockHeadAppendGamificationScript(beforeOnload: () => void): MockInstance<(node: Node) => HTMLScriptElement> {
  return vi.spyOn(document.head, "appendChild").mockImplementation(function (this: HTMLHeadElement, node: Node) {
    const el = node as HTMLScriptElement;
    if (el?.tagName === "SCRIPT" && el.src.includes("cexp-gamification") && el.onload) {
      queueMicrotask(() => {
        beforeOnload();
        el.onload?.(new Event("load"));
      });
    }
    return origHeadAppendChild.call(this, node) as HTMLScriptElement;
  });
}

describe("GamificationPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll("script[src^='https://cdn.jsdelivr.net/npm/cexp-gamification@']").forEach((n) => n.remove());
    delete (window as unknown as { cexp?: unknown }).cexp;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects cexp-web-sdk from jsDelivr using packageVersion and constructs window.cexp", async () => {
    const init = vi.fn();
    class MockCexp {
      public init = init;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    const appendSpy = mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin();
    plugin.init(hubCtx(), { apiKey: "key-1", packageVersion: "1.0.1-beta.9" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(appendSpy).toHaveBeenCalled();
    });

    const expectedUrl = scriptUrlForVersion("1.0.1-beta.9");
    const script = document.querySelector<HTMLScriptElement>(`script[src="${expectedUrl}"]`);
    expect(script).toBeTruthy();

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });
  });

  it("defaults packageVersion when omitted", async () => {
    const init = vi.fn();
    class MockCexp {
      public init = init;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin();
    plugin.init(hubCtx(), { apiKey: "key-2" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${scriptUrlForVersion(DEFAULT_VER)}"]`)).toBeTruthy();
    });
  });

  it("forwards track and identify when the vendor instance exposes them", async () => {
    const track = vi.fn();
    const identify = vi.fn();
    const init = vi.fn();

    class MockCexp {
      public track = track;
      public identify = identify;
      public init = init;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin();
    plugin.init(hubCtx(), { apiKey: "key-3" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    plugin.track("evt", { a: 1 });
    plugin.identify("u1", { tier: "gold" });

    expect(track).toHaveBeenCalledWith("evt", { a: 1 });
    expect(identify).toHaveBeenCalledWith("u1", { tier: "gold" });
  });

  it("on toggle-off removes script, calls destroy when present, and clears window.cexp", async () => {
    const destroy = vi.fn();
    const init = vi.fn();

    class MockCexp {
      public init = init;
      public destroy = destroy;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin();
    plugin.init(hubCtx(), { apiKey: "key-4" });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    const url = scriptUrlForVersion(DEFAULT_VER);
    expect(document.querySelector(`script[src="${url}"]`)).toBeTruthy();

    plugin.onToggle(false);

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${url}"]`)).toBeNull();
    });

    expect(destroy).toHaveBeenCalled();
    expect((window as unknown as { cexp?: unknown }).cexp).toBeUndefined();
  });

  it("does not inject script when apiKey is missing", async () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");

    const plugin = new GamificationPlugin();
    plugin.init(hubCtx(), { packageVersion: DEFAULT_VER });
    plugin.onToggle(true);

    await Promise.resolve();

    expect(appendSpy).not.toHaveBeenCalled();
  });
});
