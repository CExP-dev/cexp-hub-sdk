import { describe, it, expect, vi, afterEach } from "vitest";

import { createCExP } from "../src/global";

describe("CExP public surface", () => {
  it("exposes an init function", () => {
    const CExP = createCExP();
    expect(typeof CExP.init).toBe("function");
  });

  it("exposes a notification namespace with identify/reset", () => {
    const CExP = createCExP();
    expect(CExP.notification).toBeTruthy();
    expect(typeof CExP.notification.identify).toBe("function");
    expect(typeof CExP.notification.reset).toBe("function");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('script[src*="cexp.fpt.com"]').forEach((el) => el.remove());
    document
      .querySelectorAll("script[src^='https://cdn.jsdelivr.net/npm/cexp-gamification@']")
      .forEach((el) => el.remove());
    delete (globalThis as unknown as { cexp?: unknown }).cexp;
  });

  it("identify after first config resolves does not throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: "1",
            modules: [],
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

    expect(() => CExP.identify("user-42", { plan: "pro" })).not.toThrow();
  });

  it("notification.identify after first config resolves does not throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: "1",
            modules: [
              {
                id: "n",
                type: "NOTIFICATION",
                property: { appId: "00000000-0000-0000-0000-000000000000" },
              },
            ],
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

    expect(() => CExP.notification.identify("user-42")).not.toThrow();
  });
});
