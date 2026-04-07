import type { HubContext, Plugin } from "../types";

const ONESIGNAL_SCRIPT_URL =
  "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const SCRIPT_MARKER_ATTR = "data-cexp-onesignal";
/** Marks the inline bootstrap so DevTools shows the same two-tag pattern as OneSignal’s embed docs. */
const SCRIPT_INLINE_MARKER_ATTR = "data-cexp-onesignal-inline";

export type OneSignalIntegrationConfig = {
  appId?: string;
};

type OneSignalLike = {
  init: (opts: { appId: string }) => Promise<void> | void;
  login?: (externalId: string) => Promise<void> | void;
  logout?: () => Promise<void> | void;
};

type OneSignalDeferredQueue = Array<
  (oneSignal: OneSignalLike) => void | Promise<void>
>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOneSignalConfig(
  config: unknown,
): Required<Pick<OneSignalIntegrationConfig, "appId">> {
  const c = isPlainObject(config) ? config : {};
  const appId =
    typeof c.appId === "string" && c.appId.length > 0 ? c.appId : "";
  return { appId };
}

function getOneSignalDeferredQueue(): OneSignalDeferredQueue {
  const w = globalThis as unknown as { OneSignalDeferred?: unknown };
  if (!Array.isArray(w.OneSignalDeferred)) {
    w.OneSignalDeferred = [];
  }
  return w.OneSignalDeferred as OneSignalDeferredQueue;
}

/**
 * Injects an inline `<script>` before the CDN tag so the DOM matches OneSignal’s documented
 * embed (array bootstrap in markup). `OneSignalDeferred.push(...)` with `init` still runs from
 * this plugin’s JS so we can wire `identify` / lifecycle without duplicating logic.
 */
function ensureOneSignalDeferredBootstrapInline(): void {
  if (typeof document === "undefined") return;

  const existing = document.querySelector<HTMLScriptElement>(
    `script[${SCRIPT_INLINE_MARKER_ATTR}="true"]`,
  );
  if (existing) return;

  const script = document.createElement("script");
  script.setAttribute(SCRIPT_INLINE_MARKER_ATTR, "true");
  script.textContent = [
    "window.OneSignalDeferred = window.OneSignalDeferred || [];",
  ].join("\n");
  document.head.appendChild(script);
}

function ensureOneSignalScriptLoaded(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${ONESIGNAL_SCRIPT_URL}"]`,
  );
  if (existing?.getAttribute(SCRIPT_MARKER_ATTR) === "true") {
    return Promise.resolve();
  }

  if (existing && existing.getAttribute(SCRIPT_MARKER_ATTR) !== "true") {
    return new Promise((resolve, reject) => {
      const settle = (ok: boolean) => {
        if (ok) {
          existing.setAttribute(SCRIPT_MARKER_ATTR, "true");
          resolve();
        } else {
          reject(
            new Error("[OneSignalPlugin] OneSignal SDK script failed to load"),
          );
        }
      };

      existing.addEventListener("load", () => settle(true), { once: true });
      existing.addEventListener("error", () => settle(false), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ONESIGNAL_SCRIPT_URL;
    script.defer = true;

    const settle = (ok: boolean) => {
      if (ok) {
        script.setAttribute(SCRIPT_MARKER_ATTR, "true");
        resolve();
      } else {
        script.remove();
        reject(
          new Error("[OneSignalPlugin] OneSignal SDK script failed to load"),
        );
      }
    };

    script.onload = () => settle(true);
    script.onerror = () => settle(false);

    document.head.appendChild(script);
  });
}

/**
 * Loads OneSignal Web SDK v16 via `OneSignalDeferred`, associates users on `identify`,
 * and tears down script + globals on toggle-off.
 */
export class OneSignalPlugin implements Plugin {
  public readonly name = "notification";

  private ctx!: HubContext;
  private cfg!: ReturnType<typeof parseOneSignalConfig>;

  private active = false;
  private oneSignal: OneSignalLike | undefined;

  private pendingUserId: string | null = null;

  init(ctx: HubContext, config: unknown): void {
    this.ctx = ctx;
    this.cfg = parseOneSignalConfig(config);
  }

  onToggle(enabled: boolean): void {
    this.active = enabled;

    if (enabled) {
      void this.enable();
    } else {
      void this.disable();
    }
  }

  identify(userId: string): void {
    if (!this.active) return;

    this.pendingUserId = userId;

    const os = this.oneSignal;
    if (!os) return;

    void this.applyLogin(os, userId);
  }

  reset(): void {
    this.pendingUserId = null;
    const os = this.oneSignal;
    if (!os || !this.active) return;
    void this.applyLogout(os);
  }

  destroy(): void {
    void this.disable();
  }

  private async enable(): Promise<void> {
    if (!this.active || !this.cfg.appId) return;

    ensureOneSignalDeferredBootstrapInline();

    // Queue init before loading the SDK so the deferred queue is drained on startup.
    getOneSignalDeferredQueue().push(async (OneSignal: OneSignalLike) => {
      if (!this.active) return;
      await OneSignal.init({ appId: this.cfg.appId });
      if (!this.active) return;

      this.oneSignal = OneSignal;

      const uid = this.pendingUserId ?? this.ctx.getUserId();
      if (typeof uid === "string" && uid.length > 0) {
        await this.applyLogin(OneSignal, uid);
      }
    });

    try {
      await ensureOneSignalScriptLoaded();
    } catch {
      return;
    }
  }

  private async disable(): Promise<void> {
    this.active = false;

    const os = this.oneSignal;
    this.oneSignal = undefined;
    this.pendingUserId = null;

    if (os) {
      await this.applyLogout(os);
    }

    if (typeof document !== "undefined") {
      document
        .querySelectorAll<HTMLScriptElement>(
          `script[${SCRIPT_INLINE_MARKER_ATTR}="true"]`,
        )
        .forEach((el) => el.remove());
      document
        .querySelectorAll<HTMLScriptElement>(
          `script[src="${ONESIGNAL_SCRIPT_URL}"]`,
        )
        .forEach((el) => el.remove());
    }

    const w = globalThis as unknown as {
      OneSignalDeferred?: unknown;
      OneSignal?: unknown;
    };

    try {
      delete w.OneSignalDeferred;
    } catch {
      w.OneSignalDeferred = undefined;
    }
    try {
      delete w.OneSignal;
    } catch {
      w.OneSignal = undefined;
    }
  }

  private async applyLogin(
    oneSignal: OneSignalLike,
    userId: string,
  ): Promise<void> {
    try {
      if (typeof oneSignal.login === "function") {
        await oneSignal.login(userId);
        return;
      }
      const legacy = oneSignal as unknown as {
        setExternalUserId?: (id: string) => Promise<void> | void;
      };
      if (typeof legacy.setExternalUserId === "function") {
        await legacy.setExternalUserId(userId);
      }
    } catch {
      console.error("[OneSignalPlugin] login failed");
      // Best-effort; host app should not break on vendor errors.
    }
  }

  private async applyLogout(oneSignal: OneSignalLike): Promise<void> {
    try {
      if (typeof oneSignal.logout === "function") {
        await oneSignal.logout();
        return;
      }
      const legacy = oneSignal as unknown as {
        removeExternalUserId?: () => Promise<void> | void;
      };
      if (typeof legacy.removeExternalUserId === "function") {
        await legacy.removeExternalUserId();
      }
    } catch {
      console.error("[OneSignalPlugin] logout failed");
      // ignore
    }
  }
}
