import { describe, it, expect, vi, afterEach } from "vitest";

import { createCExP } from "../src/global";

/** Substring of the jsDelivr URL from `GamificationPlugin` default package version (`@1.0.1-beta.18`). */
const EXPECTED_GAMIFICATION_SCRIPT_SUBSTRING = "cexp-gamification@1.0.1-beta.18";

/** Control endpoint body uses unified wire shape (`version`, `modules[]`). */
const tokenBase = "https://staging-cexp.cads.live/gamification";

function jwtWithExp(expSec: number): string {
  const b64url = (s: string) =>
    btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(
    JSON.stringify({ exp: expSec }),
  )}.sig`;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("ControlConfig integration wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();

    // jsdom won't load external scripts, so ensure test hygiene around injected script tags.
    document
      .querySelectorAll("script[src^='https://cdn.jsdelivr.net/npm/cexp-gamification@']")
      .forEach((el) => el.remove());
    delete (globalThis as unknown as { cexp?: unknown }).cexp;
  });

  it("injects jsDelivr gamification script using CDP token flow (remote packageVersion)", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 7200;
    const jwt = jwtWithExp(expSec);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes("/sv/token")) {
          return new Response(jwt, { status: 200 });
        }
        return new Response(
          JSON.stringify({
            version: "1",
            modules: [
              {
                id: "g",
                type: "GAMIFICATION",
                property: {
                  clientKey: "ck-wiring-test",
                  tokenBaseUrl: tokenBase,
                },
              },
            ],
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
