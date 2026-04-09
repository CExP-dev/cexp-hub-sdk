/**
 * CDP gamification access token — HTTP helpers and JWT scheduling utilities.
 * @see docs/superpowers/plans/2026-04-06-gamification-access-token-implementation.md
 */

export function buildTokenUrl(tokenBaseUrl: string): string {
  const base = tokenBaseUrl.replace(/\/+$/, "");
  return `${base}/sv/token`;
}

export function normalizeTokenResponseBody(text: string): string {
  const t = text.trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t) as { token?: unknown; access_token?: unknown };
    if (typeof j.token === "string" && j.token.trim()) return j.token.trim();
    if (typeof j.access_token === "string" && j.access_token.trim()) {
      return j.access_token.trim();
    }
  } catch {
    // not JSON — treat whole body as JWT
  }
  return t;
}

/**
 * Returns JWT `exp` claim in seconds since epoch, if present and valid.
 */
export function decodeJwtExpSeconds(jwt: string): number | undefined {
  const parts = jwt.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payloadB64 = parts[1]!;
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const pad = "=".repeat(padLen);
    const json = atob(padded + pad);
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Milliseconds until the next refresh: `exp` minus skew minus now, floored at 0.
 * If the token is already past `exp - skew`, returns 0 (refresh immediately).
 */
export function msUntilRefresh(
  expSec: number,
  skewMs: number,
  nowMs: number
): number {
  return Math.max(0, expSec * 1000 - skewMs - nowMs);
}

export async function fetchGamificationAccessToken(args: {
  tokenBaseUrl: string;
  clientKey: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const fetcher = args.fetcher ?? globalThis.fetch.bind(globalThis);
  const url = buildTokenUrl(args.tokenBaseUrl);
  const res = await fetcher(url, {
    method: "GET",
    headers: {
      "X-Client-Key": args.clientKey,
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`[gamification] token fetch failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  const token = normalizeTokenResponseBody(text);
  if (!token) {
    throw new Error("[gamification] token response was empty");
  }
  return token;
}
