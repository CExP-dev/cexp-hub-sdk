import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ControlService } from "../src/hub/ControlService";
import type { ControlConfig } from "../src/config/schema";

/** Unified control wire: `version` + `modules[]` with NOTIFICATION / GAMIFICATION. */
const makeControlBody = (toggles: {
  notification?: boolean;
  gamification?: boolean;
  version?: number | string;
}) => {
  const version =
    typeof toggles.version === "number"
      ? String(toggles.version)
      : toggles.version !== undefined
        ? String(toggles.version)
        : "1";
  const modules: Array<Record<string, unknown>> = [];
  if (toggles.notification === true) {
    modules.push({ id: "n", type: "NOTIFICATION", property: {} });
  }
  if (toggles.gamification === true) {
    modules.push({ id: "g", type: "GAMIFICATION", property: {} });
  }
  return { version, modules };
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
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    fetchMock = vi.fn();
    updateSpy = vi.fn();
    originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).fetch = originalFetch;
  });

  it("keeps previous state on 304 (no body) and updates stored ETag", async () => {
    const firstBody = makeControlBody({ version: 10, notification: true });
    const parsedFirst: ControlConfig = {
      version: "10",
      integrations: {
        notification: { enabled: true },
        gamification: { enabled: false },
      },
    };

    const res200 = mockFetchResponse({ status: 200, etag: '"v1"', body: firstBody });
    const res304Json = vi.fn(async () => ({ shouldNotBeParsed: true }));
    const res304 = {
      status: 304,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "etag") return '"v304"';
          return null;
        },
      },
      json: res304Json,
    };

    const res304_2Json = vi.fn(async () => ({ shouldNotBeParsedEither: true }));
    const res304_2 = {
      status: 304,
      headers: {
        get: () => null,
      },
      json: res304_2Json,
    };

    fetchMock.mockResolvedValueOnce(res200 as any);
    fetchMock.mockResolvedValueOnce(res304 as any);
    fetchMock.mockResolvedValueOnce(res304_2 as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });

    const c1 = await svc.syncOnce();
    expect(c1).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c2 = await svc.syncOnce();
    expect(c2).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Ensure 304 path didn't parse any body.
    expect(res304Json).not.toHaveBeenCalled();

    // First request must not send If-None-Match.
    const [, firstInit] = fetchMock.mock.calls[0] as [string, any];
    expect(firstInit.method).toBe("GET");
    expect(firstInit.headers["If-None-Match"]).toBeUndefined();

    // Second request uses the initial ETag.
    const [, secondInit] = fetchMock.mock.calls[1] as [string, any];
    expect(secondInit.method).toBe("GET");
    expect(secondInit.headers["If-None-Match"]).toBe('"v1"');

    const c3 = await svc.syncOnce();
    expect(c3).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Third request uses updated ETag from the 304 response.
    const [, thirdInit] = fetchMock.mock.calls[2] as [string, any];
    expect(thirdInit.method).toBe("GET");
    expect(thirdInit.headers["If-None-Match"]).toBe('"v304"');

    // Ensure second 304 didn't parse any body.
    expect(res304_2Json).not.toHaveBeenCalled();
  });

  it("updates toggles on 200 with new body and emits callback", async () => {
    const body1 = makeControlBody({ version: 1, notification: true, gamification: false });
    const body2 = makeControlBody({ version: 2, notification: false, gamification: true });

    fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v1"', body: body1 }) as any);
    fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v2"', body: body2 }) as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });

    await svc.syncOnce();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(svc.getToggles()).toEqual({
      notification: true,
      gamification: false,
    });

    await svc.syncOnce();
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(svc.getToggles()).toEqual({
      notification: false,
      gamification: true,
    });
  });

  it("parses partial success: invalid NOTIFICATION property disables only notification; gamification still applies", async () => {
    const body = {
      version: "3",
      modules: [
        { id: "n", type: "NOTIFICATION", property: "not-a-plain-object" },
        {
          id: "g",
          type: "GAMIFICATION",
          property: { packageVersion: "1.0.1-beta.1", apiKey: "k1" },
        },
      ],
    };

    fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v1"', body }) as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    await svc.syncOnce();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(svc.getToggles()).toEqual({
      notification: false,
      gamification: true,
    });
    expect(svc.getConfig()?.version).toBe("3");
  });

  it("parses partial success: invalid GAMIFICATION property disables only gamification", async () => {
    const body = {
      version: "4",
      modules: [
        {
          id: "n",
          type: "NOTIFICATION",
          property: { appId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
        },
        { id: "g", type: "GAMIFICATION", property: null },
      ],
    };

    fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v1"', body }) as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    await svc.syncOnce();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(svc.getToggles()).toEqual({
      notification: true,
      gamification: false,
    });
  });

  it("calls onUpdate when integration config changes but enabled toggles stay the same", async () => {
    const body1 = {
      version: "1",
      modules: [
        {
          id: "g",
          type: "GAMIFICATION",
          property: { packageVersion: "1.0.1-beta.9", apiKey: "k1" },
        },
      ],
    };

    const body2 = {
      version: "1",
      modules: [
        {
          id: "g",
          type: "GAMIFICATION",
          property: { packageVersion: "1.0.1-beta.10", apiKey: "k1" },
        },
      ],
    };

    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ status: 200, etag: '"v1"', body: body1 }) as any
    );
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ status: 200, etag: '"v2"', body: body2 }) as any
    );

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });

    await svc.syncOnce();
    await svc.syncOnce();

    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps previous state on non-200 response and does not call onUpdate", async () => {
    const firstBody = makeControlBody({ version: 10, notification: true });
    const parsedFirst: ControlConfig = {
      version: "10",
      integrations: {
        notification: { enabled: true },
        gamification: { enabled: false },
      },
    };

    const res200 = mockFetchResponse({ status: 200, etag: '"v1"', body: firstBody });
    const res500Json = vi.fn(async () => ({}));
    const res500 = {
      status: 500,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "etag") return '"v500"';
          return null;
        },
      },
      json: res500Json,
    };

    fetchMock.mockResolvedValueOnce(res200 as any);
    fetchMock.mockResolvedValueOnce(res500 as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    const c1 = await svc.syncOnce();
    expect(c1).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c2 = await svc.syncOnce();
    expect(c2).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Non-200 responses should not attempt to parse JSON.
    expect(res500Json).not.toHaveBeenCalled();
  });

  it("keeps previous state when res.json throws on 200 and does not call onUpdate", async () => {
    const firstBody = makeControlBody({ version: 10, notification: true });
    const parsedFirst: ControlConfig = {
      version: "10",
      integrations: {
        notification: { enabled: true },
        gamification: { enabled: false },
      },
    };

    const res200 = mockFetchResponse({ status: 200, etag: '"v1"', body: firstBody });
    const res200BadJson = mockFetchResponse({
      status: 200,
      etag: '"v2"',
      jsonImpl: async () => {
        throw new Error("bad json");
      },
    });

    fetchMock.mockResolvedValueOnce(res200 as any);
    fetchMock.mockResolvedValueOnce(res200BadJson as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    const c1 = await svc.syncOnce();
    expect(c1).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c2 = await svc.syncOnce();
    expect(c2).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps previous state when res.json returns invalid JSON on 200 and does not call onUpdate", async () => {
    const firstBody = makeControlBody({ version: 10, notification: true });
    const parsedFirst: ControlConfig = {
      version: "10",
      integrations: {
        notification: { enabled: true },
        gamification: { enabled: false },
      },
    };

    const res200 = mockFetchResponse({ status: 200, etag: '"v1"', body: firstBody });
    const res200InvalidPayload = mockFetchResponse({
      status: 200,
      etag: '"v2"',
      body: "not-a-control-config",
      jsonImpl: async () => "not-a-control-config",
    });

    const res304 = {
      status: 304,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "etag") return '"v3"';
          return null;
        },
      },
      json: vi.fn(async () => ({ shouldNotBeParsed: true })),
    };

    fetchMock.mockResolvedValueOnce(res200 as any);
    fetchMock.mockResolvedValueOnce(res200InvalidPayload as any);
    fetchMock.mockResolvedValueOnce(res304 as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    const c1 = await svc.syncOnce();
    expect(c1).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c2 = await svc.syncOnce();
    expect(c2).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Root payload invalid on the second response (no `modules` array), but we should still persist the new ETag
    // and use it in the next conditional request.
    const c3 = await svc.syncOnce();
    expect(c3).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const [, thirdInit] = fetchMock.mock.calls[2] as [string, any];
    expect(thirdInit.method).toBe("GET");
    expect(thirdInit.headers["If-None-Match"]).toBe('"v2"');
  });

  it("keeps previous state on 200 with missing `modules` array and does not call onUpdate", async () => {
    const firstBody = makeControlBody({ version: 10, notification: true });
    const parsedFirst: ControlConfig = {
      version: "10",
      integrations: {
        notification: { enabled: true },
        gamification: { enabled: false },
      },
    };

    const res200 = mockFetchResponse({ status: 200, etag: '"v1"', body: firstBody });
    const res200MissingModules = mockFetchResponse({
      status: 200,
      etag: '"v2"',
      body: { version: "11" },
      jsonImpl: async () => ({ version: "11" }),
    });

    const res304Json = vi.fn(async () => ({ shouldNotBeParsed: true }));
    const res304 = {
      status: 304,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "etag") return '"v3"';
          return null;
        },
      },
      json: res304Json,
    };

    fetchMock.mockResolvedValueOnce(res200 as any);
    fetchMock.mockResolvedValueOnce(res200MissingModules as any);
    fetchMock.mockResolvedValueOnce(res304 as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    const c1 = await svc.syncOnce();
    expect(c1).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c2 = await svc.syncOnce();
    expect(c2).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c3 = await svc.syncOnce();
    expect(c3).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Even on strict parsing failure, ETag must be persisted.
    const [, thirdInit] = fetchMock.mock.calls[2] as [string, any];
    expect(thirdInit.headers["If-None-Match"]).toBe('"v2"');
    expect(res304Json).not.toHaveBeenCalled();
  });

  it("keeps previous state on 200 with invalid modules shape and does not call onUpdate", async () => {
    const firstBody = makeControlBody({ version: 10, notification: true });
    const parsedFirst: ControlConfig = {
      version: "10",
      integrations: {
        notification: { enabled: true },
        gamification: { enabled: false },
      },
    };

    const res200 = mockFetchResponse({ status: 200, etag: '"v1"', body: firstBody });
    const res200BadEnabled = mockFetchResponse({
      status: 200,
      etag: '"v2"',
      body: {
        version: "11",
        modules: "not-an-array",
      },
      jsonImpl: async () => ({
        version: "11",
        modules: "not-an-array",
      }),
    });

    const res304Json = vi.fn(async () => ({ shouldNotBeParsed: true }));
    const res304 = {
      status: 304,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "etag") return '"v3"';
          return null;
        },
      },
      json: res304Json,
    };

    fetchMock.mockResolvedValueOnce(res200 as any);
    fetchMock.mockResolvedValueOnce(res200BadEnabled as any);
    fetchMock.mockResolvedValueOnce(res304 as any);

    const svc = new ControlService({ controlUrl, onUpdate: updateSpy });
    const c1 = await svc.syncOnce();
    expect(c1).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c2 = await svc.syncOnce();
    expect(c2).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const c3 = await svc.syncOnce();
    expect(c3).toEqual(parsedFirst);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Even on strict parsing failure, ETag must be persisted.
    const [, thirdInit] = fetchMock.mock.calls[2] as [string, any];
    expect(thirdInit.headers["If-None-Match"]).toBe('"v2"');
    expect(res304Json).not.toHaveBeenCalled();
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

    resolveFetch?.(mockFetchResponse({ status: 200, etag: '"v1"', body: makeControlBody({ version: 1, gamification: true }) }));

    // Wait for the in-flight fetch to resolve, then allow async continuations to complete.
    await fetchPromise;
    await Promise.resolve();
    svc.stopPolling();
  });
});
