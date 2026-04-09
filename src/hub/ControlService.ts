import {
  areControlConfigsEqual,
  tryParseControlConfig,
  type ControlConfig,
} from "../config/schema";

export interface ControlServiceOptions {
  /**
   * Full endpoint URL for GET control JSON.
   * Tests will usually pass this so they can intercept requests.
   */
  controlUrl?: string;

  /**
   * If `controlUrl` is omitted, the service builds the endpoint with:
   * `${baseUrl}/v1/sdk-config?sdkId=${encodeURIComponent(sdkId)}`
   */
  baseUrl?: string;
  sdkId?: string;

  onUpdate?: (config: ControlConfig) => void;

  /**
   * Dependency injection for tests. Defaults to `globalThis.fetch`.
   */
  fetcher?: typeof fetch;
}

// const DEFAULT_CONTROL_BASE_URL = "https://fixed-host.example";
const DEFAULT_CONTROL_BASE_URL = "http://localhost:3001";

export class ControlService {
  private readonly controlUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly onUpdate?: (config: ControlConfig) => void;

  private etag: string | undefined;
  private currentConfig: ControlConfig | undefined;

  private pollingInFlight = false;
  private pollingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: ControlServiceOptions) {
    const builtUrl =
      options.controlUrl ??
      (options.sdkId
        ? `${(options.baseUrl ?? DEFAULT_CONTROL_BASE_URL).replace(
            /\/+$/,
            "",
          )}/v1/sdk-config?sdkId=${encodeURIComponent(options.sdkId)}`
        : undefined);

    // console.log("builtUrl", builtUrl);
    if (!builtUrl) {
      throw new Error(
        "[ControlService] Provide either `controlUrl` or (`sdkId` and optional `baseUrl`).",
      );
    }

    const rawFetcher = options.fetcher ?? globalThis.fetch;
    if (typeof rawFetcher !== "function") {
      throw new Error(
        "[ControlService] No fetch implementation found (provide `fetcher`).",
      );
    }

    // console.log("fetcher", fetcher);
    this.controlUrl = builtUrl;
    // Some environments expose `fetch` as a method that requires a `this` binding,
    // otherwise it can throw "Illegal invocation".
    this.fetcher = rawFetcher.bind(globalThis);
    this.onUpdate = options.onUpdate;
  }

  getConfig(): ControlConfig | undefined {
    // console.log("getConfig currentConfig", this.currentConfig);
    return this.currentConfig;
  }

  /**
   * Returns a copy of the current enabled toggles.
   * Undefined when no successful 200 response has been processed yet.
   */
  getToggles():
    | {
        notification: boolean;
        gamification: boolean;
      }
    | undefined {
    if (!this.currentConfig) return undefined;
    const { integrations } = this.currentConfig;
    return {
      notification: integrations.notification.enabled,
      gamification: integrations.gamification.enabled,
    };
  }

  private shouldUpdateConfig(next: ControlConfig): boolean {
    if (!this.currentConfig) return true;
    return !areControlConfigsEqual(this.currentConfig, next);
  }

  /**
   * Perform one conditional fetch.
   *
   * - First 200 response stores `etag`
   * - Subsequent requests send `If-None-Match`
   * - 304 keeps the previous state
   * - onUpdate is invoked only when a 200 response changes the parsed config
   */
  async syncOnce(): Promise<ControlConfig | undefined> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.etag) headers["If-None-Match"] = this.etag;

    let res: Response;
    try {
      res = await this.fetcher(this.controlUrl, { method: "GET", headers });
    } catch (err) {
      // In browsers, fetch failures are often CORS, mixed content, DNS, or a refused connection.
      // Keep last-known-good config, but emit diagnostics to help debug.
      // eslint-disable-next-line no-console
      console.error("[ControlService] fetch failed", this.controlUrl, err);
      return this.currentConfig;
    }
    if (res.status === 304) {
      // No body -> no config change, but we may still get a new ETag.
      const newEtag = res.headers.get("etag") ?? undefined;
      if (newEtag) this.etag = newEtag;
      return this.currentConfig;
    }

    if (res.status !== 200) {
      // On transient errors, keep last good config.
      return this.currentConfig;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return this.currentConfig;
    }

    // Preserve ETag progression even when strict parsing fails.
    const newEtag = res.headers.get("etag") ?? undefined;
    const parsed = tryParseControlConfig(json);
    if (newEtag) this.etag = newEtag;

    // Strict parsing failed: keep previous state and do not call `onUpdate`.
    if (!parsed) return this.currentConfig;

    if (this.shouldUpdateConfig(parsed)) {
      this.currentConfig = parsed;
      this.onUpdate?.(parsed);
    }

    return this.currentConfig;
  }

  /**
   * Start polling using `setInterval`.
   * Overlapping requests are prevented via an in-flight guard.
   */
  startPolling(intervalMs = 300_000): void {
    this.stopPolling();
    this.pollingTimer = setInterval(() => {
      void this.pollTick();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    this.pollingTimer = undefined;
  }

  private async pollTick(): Promise<void> {
    if (this.pollingInFlight) return;
    this.pollingInFlight = true;
    try {
      await this.syncOnce();
    } finally {
      this.pollingInFlight = false;
    }
  }
}
