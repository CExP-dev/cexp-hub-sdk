import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ControlService } from "../src/hub/ControlService";
import type { ControlConfig } from "../src/config/schema";

const makeControlBody = (toggles: {
  snowplow?: boolean;
  onesignal?: boolean;
  gamification?: boolean;
  identity?: boolean;
  version?: number;
}) => {
  const integrations: Record<string, { enabled: boolean }> = {};
  if (typeof toggles.snowplow === "boolean") integrations.snowplow = { enabled: toggles.snowplow };
  if (typeof toggles.onesignal === "boolean")
    integrations.onesignal = { enabled: toggles.onesignal };
  if (typeof toggles.gamification === "boolean")
    integrations.gamification = { enabled: toggles.gamification };
  if (typeof toggles.identity === "boolean") integrations.identity = { enabled: toggles.identity };

  return {
    version: typeof toggles.version === "number" ? toggles.version : 1,
    integrations,
  };
};

const mockFetchResponse = (args: {
  status: number;
  etag?: string;
  body?: unknown;
  jsonImpl?: () => Promise<unknown>;
}) => {
  const jsonMock = vi.fn(args.jsonImpl ?? (async () => args.body));
  const etagValue = args.etag;

  return {
    status: args.status,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "etag") return etagValue ?? null;
        return null;
      },
    },
    json: jsonMock,
  };
};

describe("ControlService", () => {
  const controlUrl = "https://fixed-host.example/v1/sdk-config?sdkId=test-sdk";

  let fetchMock: ReturnType<typeof vi.fn>;
  let updateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    updateSpy = vi.fn();
    (globalThis as any).fetch = fetchMock;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps previous state on 304 (no body) and sends If-None-Match", async () => {
    const firstBody = makeControlBody({ version: 10, snowplow: true });
    const parsedFirst: ControlConfig = {
      version: 10,
      integrations: {
        snowplow: { enabled: true },
        onesignal: { enabled: false },
        gamification: { enabled: false },
        identity: { enabled: false },
      },
    };

    const res200 = mockFetchResponse({ status: 200, etag: '"v1"', body: firstBody });
    const res304Json = vi.fn(async () => ({ shouldNotBeParsed: true }));
    const res304 = {
      status: 304,
      headers: {
        get: () => null,
      },
      json: res304Json,
    };

    fetchMock.mockResolvedValueOnce(res200 as any);
    fetchMock.mockResolvedValueOnce(res304 as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });

    const c1 = await svc.syncOnce();
    expect(c1).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c2 = await svc.syncOnce();
    expect(c2).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Ensure 304 path didn't parse any body.
    expect(res304Json).not.toHaveBeenCalled();

    // Ensure second request uses ETag conditional header.
    const [, secondInit] = fetchMock.mock.calls[1] as [string, any];
    expect(secondInit.method).toBe("GET");
    expect(secondInit.headers["If-None-Match"]).toBe('"v1"');
  });

  it("updates toggles on 200 with new body and emits callback", async () => {
    const body1 = makeControlBody({ version: 1, snowplow: true, onesignal: false });
    const body2 = makeControlBody({ version: 2, snowplow: false, onesignal: true });

    fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v1"', body: body1 }) as any);
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v2"', body: body2 }) as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });

    await svc.syncOnce();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(svc.getToggles()).toEqual({
      snowplow: true,
      onesignal: false,
      gamification: false,
      identity: false,
    });

    await svc.syncOnce();
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(svc.getToggles()).toEqual({
      snowplow: false,
      onesignal: true,
      gamification: false,
      identity: false,
    });
  });

  it("startPolling prevents overlapping requests (in-flight guard)", async () => {
    vi.useFakeTimers();

    let resolveFetch: ((value: any) => void) | undefined;
    const fetchPromise = new Promise<any>((resolve) => {
      resolveFetch = resolve;
    });

    fetchMock.mockImplementation(() => fetchPromise as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    svc.startPolling(100);

    vi.advanceTimersByTime(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Trigger next interval tick before the first fetch resolves.
    vi.advanceTimersByTime(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(mockFetchResponse({ status: 200, etag: '"v1"', body: makeControlBody({ version: 1, identity: true }) }));

    // Wait for the in-flight fetch to resolve, then allow async continuations to complete.
    await fetchPromise;
    await Promise.resolve();
    svc.stopPolling();
  });
});

