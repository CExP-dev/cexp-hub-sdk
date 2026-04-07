import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  GamificationPlugin,
} from "../src/plugins/gamification/GamificationPlugin";

/** Must match `buildGamificationScriptUrl` in GamificationPlugin (version often includes leading `@`). */
const DEFAULT_VER = "@1.0.1-beta.18";
const scriptUrlForVersion = (v: string) =>
  `https://cdn.jsdelivr.net/npm/cexp-gamification${v}/dist/cexp-web-sdk.js`;

function hubCtx() {
  return {
    getToggles: () => ({
      notification: false,
      gamification: true,
    }),
    getUserId: () => null,
  };
}

const origHeadAppendChild = HTMLHeadElement.prototype.appendChild;

function mockHeadAppendGamificationScript(beforeOnload: () => void) {
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

const tokenBase = "https://staging-cexp.cads.live/gamification";

function jwtWithExp(expSec: number): string {
  const b64url = (s: string) =>
    btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(
    JSON.stringify({ exp: expSec })
  )}.sig`;
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

  it("does not inject script when clientKey and tokenBaseUrl are missing", async () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");

    const plugin = new GamificationPlugin();
    plugin.init(hubCtx(), { packageVersion: DEFAULT_VER });
    plugin.onToggle(true);

    await Promise.resolve();

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("forwards identify when the vendor instance exposes it", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 7200;
    const jwt = jwtWithExp(expSec);
    const fetchMock = vi.fn(async () => new Response(jwt, { status: 200 }));

    const identify = vi.fn();
    const init = vi.fn();

    class MockCexp {
      public identify = identify;
      public init = init;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "client-key-1",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    plugin.identify("u1", { tier: "gold" });

    expect(identify).toHaveBeenCalledWith("u1", { tier: "gold" });
  });

  it("on toggle-off removes script, calls destroy, and clears window.cexp (CDP path)", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 7200;
    const jwt = jwtWithExp(expSec);
    const fetchMock = vi.fn(async () => new Response(jwt, { status: 200 }));

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

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "ck",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
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

  it("CDP JWT: fetches JWT before script load and passes it as apiKey", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 7200;
    const jwt = jwtWithExp(expSec);

    const fetchMock = vi.fn(async () => new Response(jwt, { status: 200 }));

    const init = vi.fn();
    class MockCexp {
      public init = init;
      constructor(_opts: { apiKey: string }) {
        expect(_opts.apiKey).toBe(jwt);
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "client-key-1",
      tokenBaseUrl: tokenBase,
      packageVersion: "1.0.1-beta.9",
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalledWith(`${tokenBase}/sv/token`, expect.any(Object));

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });
  });

  it("CDP JWT: refresh timer refetches JWT and recreates client", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 120;
    const jwt1 = jwtWithExp(expSec);
    const jwt2 = jwtWithExp(expSec + 60);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(jwt1, { status: 200 }))
      .mockResolvedValueOnce(new Response(jwt2, { status: 200 }));

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

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "ck",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalledTimes(1);
    });

    const skewMs = 60_000;
    const delayMs = expSec * 1000 - skewMs - Date.now();
    await vi.advanceTimersByTimeAsync(Math.max(0, delayMs) + 1);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(destroy).toHaveBeenCalled();
    expect(init).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("CDP JWT: token fetch failure does not load script", async () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "ck",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(appendSpy).not.toHaveBeenCalled();
  });
});
