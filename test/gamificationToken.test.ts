import { describe, it, expect, vi } from "vitest";

import {
  buildTokenUrl,
  decodeJwtExpSeconds,
  fetchGamificationAccessToken,
  msUntilRefresh,
  normalizeTokenResponseBody,
} from "../src/plugins/gamification/gamificationToken";

function b64urlJson(obj: object): string {
  const s = JSON.stringify(obj);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwtWithExp(expSec: number): string {
  const header = b64urlJson({ alg: "none", typ: "JWT" });
  const payload = b64urlJson({ exp: expSec });
  return `${header}.${payload}.sig`;
}

describe("gamificationToken", () => {
  it("buildTokenUrl appends /sv/token without double slashes", () => {
    expect(buildTokenUrl("https://x.cads.live/gamification")).toBe(
      "https://x.cads.live/gamification/sv/token"
    );
    expect(buildTokenUrl("https://x.cads.live/gamification/")).toBe(
      "https://x.cads.live/gamification/sv/token"
    );
  });

  it("normalizeTokenResponseBody accepts raw JWT or JSON wrappers", () => {
    expect(normalizeTokenResponseBody("  abc.def.ghi  ")).toBe("abc.def.ghi");
    expect(normalizeTokenResponseBody('{"token":"abc.def.ghi"}')).toBe(
      "abc.def.ghi"
    );
    expect(normalizeTokenResponseBody('{"access_token":"abc.def.ghi"}')).toBe(
      "abc.def.ghi"
    );
    expect(normalizeTokenResponseBody("")).toBe("");
  });

  it("decodeJwtExpSeconds reads exp from payload", () => {
    const jwt = jwtWithExp(1700000000);
    expect(decodeJwtExpSeconds(jwt)).toBe(1700000000);
    expect(decodeJwtExpSeconds("not-a-jwt")).toBeUndefined();
  });

  it("msUntilRefresh floors at zero when exp is in the past (skew)", () => {
    const nowMs = 1_000_000_000_000;
    const expSec = Math.floor(nowMs / 1000) - 100;
    expect(msUntilRefresh(expSec, 60_000, nowMs)).toBe(0);
  });

  it("fetchGamificationAccessToken GETs token URL with X-Client-Key", async () => {
    const jwt = jwtWithExp(2000000000);
    const fetcher = vi.fn(async () => new Response(jwt, { status: 200 }));

    const out = await fetchGamificationAccessToken({
      tokenBaseUrl: "https://x.cads.live/gamification",
      clientKey: "ck-1",
      fetcher,
    });

    expect(out).toBe(jwt);
    expect(fetcher).toHaveBeenCalledWith(
      "https://x.cads.live/gamification/sv/token",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-Client-Key": "ck-1" }),
      })
    );
  });

  it("fetchGamificationAccessToken throws on non-2xx", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 401 }));
    await expect(
      fetchGamificationAccessToken({
        tokenBaseUrl: "https://x.cads.live/gamification",
        clientKey: "ck",
        fetcher,
      })
    ).rejects.toThrow(/401/);
  });
});
