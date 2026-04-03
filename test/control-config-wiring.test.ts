import { describe, it, expect, vi, afterEach } from "vitest";

import { createCExP } from "../src/global";

const GAMIFICATION_VERSION_OVERRIDE = "1.0.1-beta.10";
const EXPECTED_GAMIFICATION_SCRIPT_SUBSTRING = `cexp-gamification@${GAMIFICATION_VERSION_OVERRIDE}`;

describe("ControlConfig integration wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();

    // jsdom won't load external scripts, so ensure test hygiene around injected script tags.
    document
      .querySelectorAll("script[src^='https://cdn.jsdelivr.net/npm/cexp-gamification@']")
      .forEach((el) => el.remove());
    delete (globalThis as unknown as { cexp?: unknown }).cexp;
  });

  it("injects jsDelivr gamification script using remote packageVersion and apiKey", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            version: 1,
            integrations: {
              onesignal: { enabled: false },
              gamification: {
                enabled: true,
                packageVersion: GAMIFICATION_VERSION_OVERRIDE,
                apiKey: "k_123",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json", etag: "v1" },
          },
        );
      }),
    );

    const CExP = createCExP();
    CExP.init({ id: "sdk-1" });

    await vi.waitFor(
      () => {
        const script = document.querySelector<HTMLScriptElement>(
          `script[src*="${EXPECTED_GAMIFICATION_SCRIPT_SUBSTRING}"]`,
        );
        expect(script).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});

