import type { HubContext, Plugin } from "../types";

import { IdentityStore } from "../../hub/IdentityStore";

const CDP_JS_URL = "https://octopus-stream01-cads.fpt.vn/cdp.js";
const SCRIPT_MARKER_ATTR = "data-cexp-cdp-loaded";

let cdpLoadPromise: Promise<void> | undefined;

function ensureCdpScriptLoaded(): Promise<void> {
  if (cdpLoadPromise) return cdpLoadPromise;

  if (typeof document === "undefined") {
    cdpLoadPromise = Promise.resolve();
    return cdpLoadPromise;
  }

  cdpLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CDP_JS_URL}"]`);
    if (existing) {
      if (existing.getAttribute(SCRIPT_MARKER_ATTR) === "true") {
        resolve();
        return;
      }

      // Wait for existing script to finish loading.
      existing.addEventListener(
        "load",
        () => {
          existing.setAttribute(SCRIPT_MARKER_ATTR, "true");
          resolve();
        },
        { once: true },
      );
      existing.addEventListener("error", () => reject(new Error("[CdpIdentityPlugin] cdp.js load error")), {
        once: true,
      });
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

  return cdpLoadPromise;
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
      this.syncPromise = this.handleEnable().catch(() => {
        // Swallow to avoid breaking host app if cdp.js fails to load.
      });
    }
  }

  private async handleEnable(): Promise<void> {
    try {
      await ensureCdpScriptLoaded();
    } catch {
      // Even when the script fails, IdentityStore still has a fallback path.
    }
    IdentityStore.getOrCreateFptUuid();
  }
}

