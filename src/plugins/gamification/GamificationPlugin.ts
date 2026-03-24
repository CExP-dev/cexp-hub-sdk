import type { HubContext, Plugin } from "../types";

const SCRIPT_MARKER_ATTR = "data-cexp-gamification";

const DEFAULT_PACKAGE_VERSION = "1.0.1-beta.9";

export type GamificationIntegrationConfig = {
  /**
   * npm dist-tag or semver for `cexp-gamification` on jsDelivr.
   */
  packageVersion?: string;
  apiKey?: string;
};

type CexpInstance = {
  init?: () => void | Promise<void>;
  destroy?: () => void;
  track?: (event: string, props: Record<string, unknown>) => void;
  identify?: (userId: string, traits?: Record<string, unknown>) => void;
};

type CexpCtor = new (opts: { apiKey: string }) => CexpInstance;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGamificationConfig(config: unknown): Required<GamificationIntegrationConfig> {
  const c = isPlainObject(config) ? config : {};
  const packageVersion =
    typeof c.packageVersion === "string" && c.packageVersion.length > 0 ? c.packageVersion : DEFAULT_PACKAGE_VERSION;
  const apiKey = typeof c.apiKey === "string" && c.apiKey.length > 0 ? c.apiKey : "";
  return { packageVersion, apiKey };
}

function buildGamificationScriptUrl(version: string): string {
  return `https://cdn.jsdelivr.net/npm/cexp-gamification@${version}/dist/cexp-web-sdk.js`;
}

function getCexpConstructor(): CexpCtor | undefined {
  const w = globalThis as unknown as { cexp?: unknown };
  return typeof w.cexp === "function" ? (w.cexp as CexpCtor) : undefined;
}

function ensureGamificationScriptLoaded(scriptUrl: string): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
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
          reject(new Error("[GamificationPlugin] gamification SDK script failed to load"));
        }
      };

      existing.addEventListener("load", () => settle(true), { once: true });
      existing.addEventListener("error", () => settle(false), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;

    const settle = (ok: boolean) => {
      if (ok) {
        script.setAttribute(SCRIPT_MARKER_ATTR, "true");
        resolve();
      } else {
        script.remove();
        reject(new Error("[GamificationPlugin] gamification SDK script failed to load"));
      }
    };

    script.onload = () => settle(true);
    script.onerror = () => settle(false);

    document.head.appendChild(script);
  });
}

async function waitForCexpConstructor(timeoutMs: number): Promise<CexpCtor | undefined> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const Ctor = getCexpConstructor();
    if (Ctor) return Ctor;
    if (Date.now() - start >= timeoutMs) return undefined;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
}

/**
 * Lazy-loads `cexp-gamification` from jsDelivr, constructs `window.cexp`, and optionally
 * forwards hub events when the vendor SDK exposes matching methods.
 */
export class GamificationPlugin implements Plugin {
  public readonly name = "gamification";

  private cfg!: ReturnType<typeof parseGamificationConfig>;

  private active = false;
  private client: CexpInstance | undefined;
  private scriptUrl = "";

  init(_ctx: HubContext, config: unknown): void {
    void _ctx;
    this.cfg = parseGamificationConfig(config);
  }

  onToggle(enabled: boolean): void {
    this.active = enabled;

    if (enabled) {
      void this.enable();
    } else {
      this.disable();
    }
  }

  track(event: string, props: Record<string, unknown>): void {
    if (!this.active || !this.client?.track) return;
    try {
      this.client.track(event, props);
    } catch {
      // ignore vendor errors
    }
  }

  page(_props: Record<string, unknown>): void {
    void _props;
    // No documented page hook yet; Snowplow owns page_view for analytics.
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    if (!this.active || !this.client?.identify) return;
    try {
      this.client.identify(userId, traits);
    } catch {
      // ignore
    }
  }

  reset(): void {
    // Vendor-specific reset not confirmed; hub reset is handled elsewhere in Task 12.
  }

  destroy(): void {
    this.disable();
  }

  private async enable(): Promise<void> {
    if (!this.active || !this.cfg.apiKey) return;

    this.scriptUrl = buildGamificationScriptUrl(this.cfg.packageVersion);

    try {
      await ensureGamificationScriptLoaded(this.scriptUrl);
    } catch {
      return;
    }

    if (!this.active) return;

    const Ctor = await waitForCexpConstructor(5000);
    if (!this.active || !Ctor) return;

    try {
      this.client = new Ctor({ apiKey: this.cfg.apiKey });
      const init = this.client.init;
      if (typeof init === "function") {
        await init.call(this.client);
      }
    } catch {
      this.client = undefined;
    }
  }

  private disable(): void {
    this.active = false;

    const c = this.client;
    this.client = undefined;

    if (c?.destroy) {
      try {
        c.destroy();
      } catch {
        // ignore
      }
    }

    if (typeof document !== "undefined" && this.scriptUrl) {
      document.querySelectorAll<HTMLScriptElement>(`script[src="${this.scriptUrl}"]`).forEach((el) => el.remove());
    }

    this.scriptUrl = "";

    const w = globalThis as unknown as { cexp?: unknown };
    try {
      delete w.cexp;
    } catch {
      w.cexp = undefined;
    }
  }
}
