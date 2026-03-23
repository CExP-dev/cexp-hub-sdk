const CDP_FPT_UUID_KEY = "fpt_uuid";
const CEXP_FPT_UUID_KEY = "cexp_fpt_uuid";

type CdpFptLike = {
  getFptUuid?: () => unknown;
  fpt_uuid?: unknown;
};

function uuidV4(): string {
  // Avoid depending on `crypto` availability across all runtimes.
  const cryptoObj = globalThis.crypto;
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // version 4
  const b6 = bytes[6] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x40;
  // variant 10xx
  const b8 = bytes[8] ?? 0;
  bytes[8] = (b8 & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(
    20,
  )}`;
}

function safeReadLocalStorage(key: string): string | undefined {
  try {
    const v = globalThis.localStorage?.getItem?.(key);
    if (typeof v === "string" && v.length > 0) return v;
    return undefined;
  } catch {
    return undefined;
  }
}

function safeWriteLocalStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem?.(key, value);
  } catch {
    // Storage may be blocked; identity is still usable for the session.
  }
}

function readCookieValue(name: string): string | undefined {
  try {
    if (typeof document === "undefined" || typeof document.cookie !== "string") return undefined;

    const encodedName = encodeURIComponent(name);
    const parts = document.cookie.split(";").map((p) => p.trim());
    for (const part of parts) {
      if (!part) continue;
      const eqIdx = part.indexOf("=");
      if (eqIdx < 0) continue;
      const k = part.slice(0, eqIdx).trim();
      const rawVal = part.slice(eqIdx + 1).trim();
      // Cookies may be encoded; compare encoded forms to avoid mismatches.
      if (k === encodedName || k === name) {
        const val = decodeURIComponent(rawVal);
        if (typeof val === "string" && val.length > 0) return val;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeCookieValue(name: string, value: string): void {
  try {
    if (typeof document === "undefined") return;
    // 1 year default retention; adjust later if product requires longer/shorter.
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
      value,
    )}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Ignore cookie write failures.
  }
}

function readFromCdpFpt(): string | undefined {
  const cdpFpt = (globalThis as unknown as { cdpFpt?: CdpFptLike }).cdpFpt;
  if (!cdpFpt || typeof cdpFpt !== "object") return undefined;

  const getter = cdpFpt.getFptUuid;
  if (typeof getter === "function") {
    try {
      const val = getter.call(cdpFpt);
      if (typeof val === "string" && val.length > 0) return val;
    } catch {
      // ignore
    }
  }

  const propVal = cdpFpt.fpt_uuid;
  if (typeof propVal === "string" && propVal.length > 0) return propVal;

  return undefined;
}

function readFromExistingMirrors(): string | undefined {
  // Prefer CDP's likely raw key names if they already exist.
  const fromLs = safeReadLocalStorage(CDP_FPT_UUID_KEY) ?? safeReadLocalStorage(CEXP_FPT_UUID_KEY);
  if (fromLs) return fromLs;

  const fromCookie = readCookieValue(CDP_FPT_UUID_KEY) ?? readCookieValue(CEXP_FPT_UUID_KEY);
  if (fromCookie) return fromCookie;

  return undefined;
}

function persistMirror(uuid: string): void {
  // Persist under hub-namespaced key for consistency across plugins/tasks.
  safeWriteLocalStorage(CEXP_FPT_UUID_KEY, uuid);
  writeCookieValue(CEXP_FPT_UUID_KEY, uuid);
}

export class IdentityStore {
  static readonly cexpFptUuidKey = CEXP_FPT_UUID_KEY;

  /**
   * Resolve `fpt_uuid` using:
   * - `window.cdpFpt.getFptUuid?.()` or `window.cdpFpt.fpt_uuid`
   * - existing storage mirrors (`fpt_uuid` / `cexp_fpt_uuid` from LS + cookie)
   * - UUID v4 generation as a last resort
   *
   * Always persists the resolved UUID to the namespaced `cexp_fpt_uuid` mirror.
   */
  static getOrCreateFptUuid(): string {
    const fromCdp = readFromCdpFpt();
    const fromMirrors = fromCdp ? undefined : readFromExistingMirrors();
    const resolved = fromCdp ?? fromMirrors ?? uuidV4();
    persistMirror(resolved);
    return resolved;
  }
}

