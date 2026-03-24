import { describe, it, expect, vi, afterEach } from "vitest";

import { createCExP } from "../src/global";

describe("CExP public surface", () => {
  it("exposes an init function", () => {
    const CExP = createCExP();
    expect(typeof CExP.init).toBe("function");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('script[src*="cexp.fpt.com"]').forEach((el) => el.remove());
    delete (globalThis as unknown as { snowplow?: unknown }).snowplow;
  });

  it("init + pre-init queue flush routes identify/track/page through Snowplow when enabled", async () => {
    const snowplow = vi.fn();

    const head = document.head;
    const originalAppend = head.appendChild.bind(head);
    vi.spyOn(head, "appendChild").mockImplementation((node: Node) => {
      if (node instanceof HTMLScriptElement && node.src.includes("cexp.fpt.com/sdk/acti/cdp.js")) {
        queueMicrotask(() => {
          (globalThis as unknown as { snowplow: typeof snowplow }).snowplow = snowplow;
          node.dispatchEvent(new Event("load"));
        });
      }
      return originalAppend(node);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 1,
            integrations: {
              snowplow: { enabled: true },
              onesignal: { enabled: false },
              gamification: { enabled: false },
              identity: { enabled: false },
            },
          }),
          { status: 200, headers: { "content-type": "application/json", etag: "v1" } },
        ),
      ),
    );

    const CExP = createCExP();
    CExP.init({ id: "sdk-1" });
    CExP.identify("user-42", { plan: "pro" });
    CExP.track("purchase", { amount: 10 });

    await vi.waitFor(() => {
      expect(snowplow.mock.calls.some((c) => c[0] === "newTracker")).toBe(true);
      expect(snowplow.mock.calls.some((c) => c[0] === "trackSelfDescribingEvent")).toBe(true);
    });

    CExP.page({ title: "Custom" });

    await vi.waitFor(() => {
      expect(snowplow.mock.calls.some((c) => c[0] === "trackPageView")).toBe(true);
    });

    const trackCall = snowplow.mock.calls.find((c) => c[0] === "trackSelfDescribingEvent");
    expect(trackCall).toBeDefined();
    const payload = trackCall?.[1] as { context?: Array<{ data: Record<string, unknown> }> };
    expect(payload.context?.[0]?.data).toMatchObject({
      userId: "user-42",
      traits: { plan: "pro" },
    });
  });
});

