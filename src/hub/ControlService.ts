import { areControlConfigsEqual, parseControlConfig, type ControlConfig } from "../config/schema";

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

const DEFAULT_CONTROL_BASE_URL = "https://fixed-host.example";

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isValidControlJson = (input: unknown): input is Record<string, unknown> => {
  if (!isPlainObject(input)) return false;

  // `version` is expected to be a finite number when present.
  if ("version" in input && input.version !== undefined) {
    if (typeof input.version !== "number" || !Number.isFinite(input.version)) return false;
  }

  // `integrations` is expected to be an object when present.
  if ("integrations" in input && input.integrations !== undefined) {
    if (!isPlainObject(input.integrations)) return false;
  }

  return true;
};

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
        ? `${(options.baseUrl ?? DEFAULT_CONTROL_BASE_URL).replace(/\/+$/, "")}/v1/sdk-config?sdkId=${encodeURIComponent(
            options.sdkId,
          )}`
        : undefined);

    if (!builtUrl) {
      throw new Error(
        "[ControlService] Provide either `controlUrl` or (`sdkId` and optional `baseUrl`).",
      );
    }

    const fetcher = options.fetcher ?? globalThis.fetch;
    if (typeof fetcher !== "function") {
      throw new Error("[ControlService] No fetch implementation found (provide `fetcher`).");
    }

    this.controlUrl = builtUrl;
    this.fetcher = fetcher;
    this.onUpdate = options.onUpdate;
  }

  getConfig(): ControlConfig | undefined {
    return this.currentConfig;
  }

  /**
   * Returns a copy of the current enabled toggles.
   * Undefined when no successful 200 response has been processed yet.
   */
  getToggles():
    | {
        snowplow: boolean;
        onesignal: boolean;
        gamification: boolean;
        identity: boolean;
      }
    | undefined {
    if (!this.currentConfig) return undefined;
    const { integrations } = this.currentConfig;
    return {
      snowplow: integrations.snowplow.enabled,
      onesignal: integrations.onesignal.enabled,
      gamification: integrations.gamification.enabled,
      identity: integrations.identity.enabled,
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
    } catch {
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

    // If the response payload is clearly not a control config, don't apply safe defaults.
    // This prevents accidental "disable everything" updates on malformed responses.
    if (!isValidControlJson(json)) {
      // Even when strict parsing fails, conditional requests should advance via ETag.
      // Important: do not change `currentConfig` and do not call `onUpdate`.
      const newEtag = res.headers.get("etag") ?? undefined;
      if (newEtag) this.etag = newEtag;
      return this.currentConfig;
    }

    const newEtag = res.headers.get("etag") ?? undefined;
    const parsed = parseControlConfig(json);

    // Store ETag even if parsed toggles didn't change.
    if (newEtag) this.etag = newEtag;

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

