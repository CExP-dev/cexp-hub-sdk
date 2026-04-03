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
    document
      .querySelectorAll("script[src^='https://cdn.jsdelivr.net/npm/cexp-gamification@']")
      .forEach((el) => el.remove());
    delete (globalThis as unknown as { cexp?: unknown }).cexp;
  });

  it("init syncs control config and allows track after first config resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 1,
            integrations: {
              onesignal: { enabled: false },
              gamification: { enabled: false },
            },
          }),
          { status: 200, headers: { "content-type": "application/json", etag: "v1" } },
        ),
      ),
    );

    const CExP = createCExP();
    CExP.init({ id: "sdk-1" });

    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });

    expect(() => CExP.track("purchase", { amount: 10 })).not.toThrow();
  });
});
