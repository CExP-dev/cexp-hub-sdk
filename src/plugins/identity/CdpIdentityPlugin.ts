import type { HubContext, Plugin } from "../types";

import { IdentityStore } from "../../hub/IdentityStore";

const CDP_JS_URL = "https://octopus-stream01-cads.fpt.vn/cdp.js";
const SCRIPT_MARKER_ATTR = "data-cexp-cdp-loaded";

// When an existing script tag is present without our marker, we can't rely on
// `load`/`error` events firing again (e.g. if it already loaded earlier).
// Always settle so enable attempts never hang.
export const CDP_SCRIPT_LOAD_TIMEOUT_MS = 1500;

// After `cdp.js` "loads", `window.cdpFpt` may still be initialized asynchronously.
// We poll briefly to avoid generating and persisting a random UUID prematurely.
export const CDP_FPT_READY_TIMEOUT_MS = 2000;
const CDP_FPT_READY_POLL_INTERVAL_MS = 50;

let cdpLoadPromise: Promise<void> | undefined;

type CdpFptLike = {
  getFptUuid?: () => unknown;
  fpt_uuid?: unknown;
};

function getCdpFptUuidIfReady(): string | undefined {
  const cdpFpt = (globalThis as unknown as { cdpFpt?: CdpFptLike }).cdpFpt;
  if (!cdpFpt || typeof cdpFpt !== "object") return undefined;

  const getter = cdpFpt.getFptUuid;
  if (typeof getter === "function") {
    try {
      const val = getter.call(cdpFpt);
      if (typeof val === "string" && val.length > 0) return val;
    } catch {
      // ignore; treat as not-ready
    }
  }

  const propVal = cdpFpt.fpt_uuid;
  if (typeof propVal === "string" && propVal.length > 0) return propVal;

  return undefined;
}

async function waitForCdpFptReady(): Promise<void> {
  const start = Date.now();
  // Poll using setTimeout (not requestAnimationFrame) so fake timers in tests work.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (getCdpFptUuidIfReady()) return;
    if (Date.now() - start >= CDP_FPT_READY_TIMEOUT_MS) return;
    await new Promise<void>((r) => setTimeout(r, CDP_FPT_READY_POLL_INTERVAL_MS));
  }
}

function ensureCdpScriptLoaded(): Promise<void> {
  if (cdpLoadPromise) return cdpLoadPromise;

  if (typeof document === "undefined") {
    cdpLoadPromise = Promise.resolve();
    return cdpLoadPromise;
  }

  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CDP_JS_URL}"]`);
    if (existing) {
      if (existing.getAttribute(SCRIPT_MARKER_ATTR) === "true") {
        resolve();
        return;
      }

      // If cdpFpt is already initialized, we can treat the script as effectively loaded.
      if (getCdpFptUuidIfReady()) {
        existing.setAttribute(SCRIPT_MARKER_ATTR, "true");
        resolve();
        return;
      }

      // Wait for existing script to finish loading, but ensure we never hang:
      // if the browser won't re-fire events, we settle via timeout.
      const timeoutId = setTimeout(() => {
        reject(new Error("[CdpIdentityPlugin] cdp.js load timeout"));
      }, CDP_SCRIPT_LOAD_TIMEOUT_MS);

      existing.addEventListener(
        "load",
        () => {
          clearTimeout(timeoutId);
          existing.setAttribute(SCRIPT_MARKER_ATTR, "true");
          resolve();
        },
        { once: true },
      );
      existing.addEventListener(
        "error",
        () => {
          clearTimeout(timeoutId);
          reject(new Error("[CdpIdentityPlugin] cdp.js load error"));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CDP_JS_URL;
    script.async = true;

    script.onload = () => {
      script.setAttribute(SCRIPT_MARKER_ATTR, "true");
      resolve();
    };

    script.onerror = () => {
      reject(new Error("[CdpIdentityPlugin] cdp.js load error"));
    };

    // Inject exactly once per browser runtime (guarded by module-level promise).
    document.head.appendChild(script);
  });

  cdpLoadPromise = p;
  // Retry-friendly: if the load fails, clear the module-scoped promise so
  // subsequent enable attempts can try again.
  p.catch(() => {
    if (cdpLoadPromise === p) cdpLoadPromise = undefined;
  });

  return p;
}

export class CdpIdentityPlugin implements Plugin {
  public readonly name = "identity";

  // Tracks async work spawned from `onToggle(true)` so tests (and future wiring)
  // can await a consistent completion point.
  private syncPromise: Promise<void> | undefined;

  init(_ctx: HubContext, _config: unknown): void {
    // Intentionally empty: identity is enabled/disabled via remote toggles.
  }

  onToggle(enabled: boolean): void {
    if (!enabled) return;

    if (!this.syncPromise) {
      this.syncPromise = this.handleEnable()
        .catch(() => {
          // Swallow to avoid breaking host app if cdp.js fails to load.
        })
        .finally(() => {
          // Allow subsequent enable attempts after completion/failure.
          this.syncPromise = undefined;
        });
    }
  }

  private async handleEnable(): Promise<void> {
    try {
      await ensureCdpScriptLoaded();
    } catch {
      // Even when the script fails, IdentityStore still has a fallback path.
    }

    // Avoid generating and persisting a random UUID before CDP finished initializing.
    await waitForCdpFptReady();
    IdentityStore.getOrCreateFptUuid();
  }
}

