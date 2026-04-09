/**
 * Shared parsing helpers for unified control config (and equality checks).
 * Kept separate from `schema.ts` to avoid circular imports with `unifiedControl.ts`.
 */

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  try {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
};

export const safeNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

// Interpolated only into a jsDelivr version segment on a fixed host.
const GAMIFICATION_PACKAGE_VERSION_ALLOWLIST = /^@?[0-9A-Za-z][0-9A-Za-z+._-]*$/;
const GAMIFICATION_PACKAGE_VERSION_MAX_LENGTH = 128;

const GAMIFICATION_TOKEN_BASE_URL_MAX_LENGTH = 512;

const isAllowedGamificationTokenHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  return h === "cads.live" || h.endsWith(".cads.live");
};

/**
 * Accepts `https` URLs on allowlisted hosts with pathname prefix `/gamification`.
 * Strips trailing slashes and drops URL `search` / `hash` so the stored value is stable.
 */
export const safeTokenBaseUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.length > GAMIFICATION_TOKEN_BASE_URL_MAX_LENGTH) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!isAllowedGamificationTokenHost(url.hostname)) return undefined;
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.length === 0) pathname = "/";
  if (!pathname.startsWith("/gamification")) return undefined;
  url.pathname = pathname;
  const serialized = url.toString().replace(/\/+$/, "");
  return serialized.length > 0 ? serialized : undefined;
};

export const safePackageVersion = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.length > GAMIFICATION_PACKAGE_VERSION_MAX_LENGTH) return undefined;
  if (!GAMIFICATION_PACKAGE_VERSION_ALLOWLIST.test(value)) return undefined;
  return value;
};
