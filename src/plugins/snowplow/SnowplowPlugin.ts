import type { HubContext, Plugin } from "../types";

const SNOWPLOW_SCRIPT_URL = "https://cexp.fpt.com/sdk/acti/cdp.js";
const SCRIPT_MARKER_ATTR = "data-cexp-snowplow-tracker";

/** Custom context entity for identity (see plan / Iglu registration). */
export const CEXP_IDENTITY_CONTEXT_SCHEMA = "iglu:com.fpt/cexp_identity/jsonschema/1-0-0";

/** Generic self-describing envelope for `CExP.track` until per-event Iglu schemas exist. */
export const CEXP_CUSTOM_EVENT_SCHEMA = "iglu:com.fpt/cexp_custom_event/jsonschema/1-0-0";

const DEFAULT_COLLECTOR_URL = "https://octopus-stream01-cads.fpt.vn";
const DEFAULT_POST_PATH = "/com.fpt/t";
const DEFAULT_APP_ID = "cexp-web";
const DEFAULT_TRACKER_NAMESPACE = "sp1";

export type SnowplowIntegrationConfig = {
  collectorUrl?: string;
  appId?: string;
  postPath?: string;
  /**
   * First argument to `snowplow('newTracker', namespace, ...)`.
   */
  trackerNamespace?: string;
};

type SnowplowCommandFn = (...args: unknown[]) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSnowplowConfig(config: unknown): Required<SnowplowIntegrationConfig> & { trackerNamespace: string } {
  const c = isPlainObject(config) ? config : {};
  const collectorUrl = typeof c.collectorUrl === "string" && c.collectorUrl.length > 0 ? c.collectorUrl : DEFAULT_COLLECTOR_URL;
  const appId = typeof c.appId === "string" && c.appId.length > 0 ? c.appId : DEFAULT_APP_ID;
  const postPath = typeof c.postPath === "string" && c.postPath.length > 0 ? c.postPath : DEFAULT_POST_PATH;
  const trackerNamespace =
    typeof c.trackerNamespace === "string" && c.trackerNamespace.length > 0 ? c.trackerNamespace : DEFAULT_TRACKER_NAMESPACE;

  return { collectorUrl, appId, postPath, trackerNamespace };
}

function getSnowplowGlobal(): SnowplowCommandFn | undefined {
  const w = globalThis as unknown as { snowplow?: unknown };
  return typeof w.snowplow === "function" ? (w.snowplow as SnowplowCommandFn) : undefined;
}

function ensureSnowplowScriptLoaded(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SNOWPLOW_SCRIPT_URL}"]`);
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
          reject(new Error("[SnowplowPlugin] Snowplow tracker script failed to load"));
        }
      };

      existing.addEventListener("load", () => settle(true), { once: true });
      existing.addEventListener("error", () => settle(false), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SNOWPLOW_SCRIPT_URL;
    script.async = true;

    const settle = (ok: boolean) => {
      if (ok) {
        script.setAttribute(SCRIPT_MARKER_ATTR, "true");
        resolve();
      } else {
        script.remove();
        reject(new Error("[SnowplowPlugin] Snowplow tracker script failed to load"));
      }
    };

    script.onload = () => settle(true);
    script.onerror = () => settle(false);

    document.head.appendChild(script);
  });
}

async function waitForSnowplowGlobal(timeoutMs: number): Promise<SnowplowCommandFn | undefined> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fn = getSnowplowGlobal();
    if (fn) return fn;
    if (Date.now() - start >= timeoutMs) return undefined;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
}

/**
 * Loads the self-hosted Snowplow tracker, configures the collector, and forwards
 * hub events using self-describing events plus the identity context entity.
 */
export class SnowplowPlugin implements Plugin {
  public readonly name = "snowplow";

  private ctx!: HubContext;
  private cfg!: ReturnType<typeof parseSnowplowConfig>;

  private active = false;
  private trackerInitialized = false;

  private userId: string | null = null;
  private traits: Record<string, unknown> | undefined;

  init(ctx: HubContext, config: unknown): void {
    this.ctx = ctx;
    this.cfg = parseSnowplowConfig(config);
  }

  onToggle(enabled: boolean): void {
    this.active = enabled;

    if (enabled) {
      void this.enableTracker();
    } else {
      this.disableTracker();
    }
  }

  reset(): void {
    this.userId = null;
    this.traits = undefined;
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    this.userId = userId;
    this.traits = traits;
  }

  track(event: string, props: Record<string, unknown>): void {
    const sp = getSnowplowGlobal();
    if (!this.active || !this.trackerInitialized || !sp) return;

    sp(
      "trackSelfDescribingEvent",
      {
        event: {
          schema: CEXP_CUSTOM_EVENT_SCHEMA,
          data: {
            event_name: event,
            properties: props,
          },
        },
        context: this.buildIdentityContexts(),
      },
    );
  }

  page(props: Record<string, unknown>): void {
    const sp = getSnowplowGlobal();
    if (!this.active || !this.trackerInitialized || !sp) return;

    const { context: _drop, ...rest } = props;
    sp("trackPageView", {
      ...rest,
      context: this.buildIdentityContexts(),
    });
  }

  private async enableTracker(): Promise<void> {
    if (!this.active) return;

    try {
      await ensureSnowplowScriptLoaded();
    } catch {
      return;
    }

    if (!this.active) return;

    const sp = await waitForSnowplowGlobal(5000);
    if (!this.active || !sp) return;

    if (!this.trackerInitialized) {
      sp("newTracker", this.cfg.trackerNamespace, this.cfg.collectorUrl, {
        appId: this.cfg.appId,
        platform: "web",
        encodeBase64: true,
        post: true,
        postPath: this.cfg.postPath,
      });

      sp("enableActivityTracking", {
        minimumVisitLength: 5,
        heartbeatDelay: 10,
      });

      this.trackerInitialized = true;
    }
  }

  private disableTracker(): void {
    const sp = getSnowplowGlobal();
    if (sp && this.trackerInitialized) {
      try {
        sp("deleteTracker", this.cfg.trackerNamespace);
      } catch {
        // Older trackers may not support deleteTracker; continue cleanup.
      }
    }

    this.trackerInitialized = false;

    if (typeof document !== "undefined") {
      document.querySelectorAll<HTMLScriptElement>(`script[src="${SNOWPLOW_SCRIPT_URL}"]`).forEach((el) => el.remove());
    }

    const w = globalThis as unknown as { snowplow?: unknown };
    if (w.snowplow) {
      try {
        delete w.snowplow;
      } catch {
        w.snowplow = undefined;
      }
    }
  }

  private buildIdentityContexts(): Array<{ schema: string; data: Record<string, unknown> }> {
    const anon = this.ctx.getAnonymousId();
    return [
      {
        schema: CEXP_IDENTITY_CONTEXT_SCHEMA,
        data: {
          fpt_uuid: typeof anon === "string" ? anon : "",
          userId: this.userId,
          traits: this.traits ?? {},
        },
      },
    ];
  }
}
