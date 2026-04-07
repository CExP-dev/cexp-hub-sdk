# Plugin Cleanup & Notification Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead/placeholder methods from plugins, strip `track`/`page` from the public API, and rename the `onesignal` integration key to `notification` across the SDK.

**Architecture:** Three layers of cleanup: (1) remove no-op methods (`track`, `page`, `reset`) from GamificationPlugin and `track?`/`page?` from the Plugin interface, (2) propagate removal through EventRouter → public API → exports, (3) rename the `onesignal` integration key to `notification` everywhere (types, config schema, Hub, router, plugin name, tests). The OneSignal class name stays — only the registry key and public-facing name change.

**Tech Stack:** TypeScript, Vitest, tsup

**Pre-existing test failures:** 5 tests in `GamificationPlugin.test.ts` and 1 in `control-config-wiring.test.ts` already fail on `main` because the static `apiKey` code path is commented out in `GamificationPlugin.enable()`. These failures are **not introduced by this plan** — they will be fixed as a side effect of Task 2 which removes the tests that relied on the dead code path.

---

## File Map

| File | Changes |
|------|---------|
| `src/plugins/types.ts` | Remove `track?` and `page?` from `Plugin` interface |
| `src/plugins/gamification/GamificationPlugin.ts` | Remove `track()`, `page()`, `reset()` methods |
| `src/hub/EventRouter.ts` | Remove `track()`, `page()` methods; update `reset()` to only call notification plugin |
| `src/types.ts` | Remove `track` and `page` from `CExPApi`; rename `onesignal` → `notification` in `IntegrationToggles` |
| `src/global.ts` | Remove `track`/`page` from implementation + preInitQueue; rename plugin override key |
| `src/index.ts` | Remove `track` and `page` exports |
| `src/config/schema.ts` | Rename `IntegrationKey`, toggle config types, parsing, equality — `onesignal` → `notification` |
| `src/hub/Hub.ts` | Rename in `PLUGIN_ORDER`, `DEFAULT_TOGGLES`, `setControlConfig`, `deriveTogglesFromControlConfig` |
| `src/plugins/onesignal/OneSignalPlugin.ts` | Change `name` to `"notification"`; remove `void _traits` |
| `test/GamificationPlugin.test.ts` | Remove track-forwarding test + dead-`apiKey` tests |
| `test/EventRouter.test.ts` | Remove track/page tests; update reset; rename recording plugin keys |
| `test/global-api.test.ts` | Remove track test; rename config keys |
| `test/hub-plugin-registry.test.ts` | Rename config keys |
| `test/OneSignalPlugin.test.ts` | Rename toggle keys |
| `test/parseControlConfig.test.ts` | Rename config keys |
| `test/control-config-wiring.test.ts` | Rename config keys |

---

### Task 1: Remove `track?` and `page?` from Plugin interface

**Files:**
- Modify: `src/plugins/types.ts`

- [x] **Step 1: Remove `track?` and `page?` from `Plugin` interface**

```typescript
// In src/plugins/types.ts — delete these two blocks entirely:

  /**
   * Optional event hook for event tracking.
   *
   * Used by later tasks to delegate routing to plugins.
   */
  track?(event: string, props: Record<string, unknown>): void;

  /**
   * Optional hook for page/view navigation events.
   */
  page?(props: Record<string, unknown>): void;
```

After removal the interface retains: `name`, `init`, `onToggle`, `identify?`, `reset?`, `destroy?`.

- [x] **Step 2: Run type check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: Errors in `GamificationPlugin.ts` (implements removed methods) and `EventRouter.ts` (calls removed methods). These are expected — Tasks 2–3 fix them.

**Done:** `tsc` passes on this branch (`EventRouter` no longer calls `track`/`page`).

- [x] **Step 3: Commit**

```bash
git add src/plugins/types.ts
git commit -m "refactor: remove track and page from Plugin interface"
```

---

### Task 2: Remove `track()`, `page()`, `reset()` from GamificationPlugin + update tests

**Files:**
- Modify: `src/plugins/gamification/GamificationPlugin.ts`
- Modify: `test/GamificationPlugin.test.ts`

- [x] **Step 1: Rewrite `test/GamificationPlugin.test.ts`**

Replace the full file with the content below. Changes from the original:
- Removed the `"forwards track and identify when the vendor instance exposes them"` test (track removed; identify is kept as a standalone test).
- Removed 3 tests that relied on the dead static-`apiKey` code path: `"injects cexp-web-sdk..."`, `"defaults packageVersion when omitted"`, `"on toggle-off removes script..."` (these were already failing on main).
- Replaced with a `"forwards identify when the vendor instance exposes it"` test that uses the CDP JWT path.
- Added a `"on toggle-off removes script, calls destroy, and clears window.cexp (CDP path)"` test using the CDP path.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

import {
  GamificationPlugin,
} from "../src/plugins/gamification/GamificationPlugin";

const DEFAULT_VER = "@1.0.1-beta.18";
const scriptUrlForVersion = (v: string) =>
  `https://cdn.jsdelivr.net/npm/cexp-gamification${v}/dist/cexp-web-sdk.js`;

function hubCtx() {
  return {
    getToggles: () => ({
      notification: false,
      gamification: true,
    }),
    getUserId: () => null,
  };
}

const origHeadAppendChild = HTMLHeadElement.prototype.appendChild;

function mockHeadAppendGamificationScript(beforeOnload: () => void): MockInstance<(node: Node) => HTMLScriptElement> {
  return vi.spyOn(document.head, "appendChild").mockImplementation(function (this: HTMLHeadElement, node: Node) {
    const el = node as HTMLScriptElement;
    if (el?.tagName === "SCRIPT" && el.src.includes("cexp-gamification") && el.onload) {
      queueMicrotask(() => {
        beforeOnload();
        el.onload?.(new Event("load"));
      });
    }
    return origHeadAppendChild.call(this, node) as HTMLScriptElement;
  });
}

const tokenBase = "https://staging-cexp.cads.live/gamification";

function jwtWithExp(expSec: number): string {
  const b64url = (s: string) =>
    btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(
    JSON.stringify({ exp: expSec })
  )}.sig`;
}

describe("GamificationPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll("script[src^='https://cdn.jsdelivr.net/npm/cexp-gamification@']").forEach((n) => n.remove());
    delete (window as unknown as { cexp?: unknown }).cexp;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not inject script when clientKey and tokenBaseUrl are missing", async () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");

    const plugin = new GamificationPlugin();
    plugin.init(hubCtx(), { packageVersion: DEFAULT_VER });
    plugin.onToggle(true);

    await Promise.resolve();

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("forwards identify when the vendor instance exposes it", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 7200;
    const jwt = jwtWithExp(expSec);
    const fetchMock = vi.fn(async () => new Response(jwt, { status: 200 }));

    const identify = vi.fn();
    const init = vi.fn();

    class MockCexp {
      public identify = identify;
      public init = init;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "client-key-1",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    plugin.identify("u1", { tier: "gold" });

    expect(identify).toHaveBeenCalledWith("u1", { tier: "gold" });
  });

  it("on toggle-off removes script, calls destroy, and clears window.cexp (CDP path)", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 7200;
    const jwt = jwtWithExp(expSec);
    const fetchMock = vi.fn(async () => new Response(jwt, { status: 200 }));

    const destroy = vi.fn();
    const init = vi.fn();

    class MockCexp {
      public init = init;
      public destroy = destroy;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "ck",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });

    const url = scriptUrlForVersion(DEFAULT_VER);
    expect(document.querySelector(`script[src="${url}"]`)).toBeTruthy();

    plugin.onToggle(false);

    await vi.waitFor(() => {
      expect(document.querySelector(`script[src="${url}"]`)).toBeNull();
    });

    expect(destroy).toHaveBeenCalled();
    expect((window as unknown as { cexp?: unknown }).cexp).toBeUndefined();
  });

  it("CDP JWT: fetches JWT before script load and passes it as apiKey", async () => {
    const expSec = Math.floor(Date.now() / 1000) + 7200;
    const jwt = jwtWithExp(expSec);

    const fetchMock = vi.fn(async () => new Response(jwt, { status: 200 }));

    const init = vi.fn();
    class MockCexp {
      public init = init;
      constructor(_opts: { apiKey: string }) {
        expect(_opts.apiKey).toBe(jwt);
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "client-key-1",
      tokenBaseUrl: tokenBase,
      packageVersion: "1.0.1-beta.9",
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalledWith(`${tokenBase}/sv/token`, expect.any(Object));

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalled();
    });
  });

  it("CDP JWT: refresh timer refetches JWT and recreates client", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 120;
    const jwt1 = jwtWithExp(expSec);
    const jwt2 = jwtWithExp(expSec + 60);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(jwt1, { status: 200 }))
      .mockResolvedValueOnce(new Response(jwt2, { status: 200 }));

    const destroy = vi.fn();
    const init = vi.fn();
    class MockCexp {
      public init = init;
      public destroy = destroy;
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    }

    mockHeadAppendGamificationScript(() => {
      (window as unknown as { cexp: typeof MockCexp }).cexp = MockCexp as unknown as typeof MockCexp;
    });

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "ck",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(init).toHaveBeenCalledTimes(1);
    });

    const skewMs = 60_000;
    const delayMs = expSec * 1000 - skewMs - Date.now();
    await vi.advanceTimersByTimeAsync(Math.max(0, delayMs) + 1);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(destroy).toHaveBeenCalled();
    expect(init).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("CDP JWT: token fetch failure does not load script", async () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));

    const plugin = new GamificationPlugin({ fetchImpl: fetchMock });
    plugin.init(hubCtx(), {
      clientKey: "ck",
      tokenBaseUrl: tokenBase,
      packageVersion: DEFAULT_VER,
    });
    plugin.onToggle(true);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(appendSpy).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run tests to verify the test file works against current code**

Run: `npx vitest run test/GamificationPlugin.test.ts`
Expected: All tests pass (the broken apiKey-path tests are gone; remaining tests use CDP JWT path which works).

- [x] **Step 3: Remove `track()`, `page()`, `reset()` from GamificationPlugin**

In `src/plugins/gamification/GamificationPlugin.ts`, delete these three methods entirely:

```typescript
  // DELETE this method (lines ~192-199)
  track(event: string, props: Record<string, unknown>): void {
    if (!this.active || !this.client?.track) return;
    try {
      this.client.track(event, props);
    } catch {
      // ignore vendor errors
    }
  }

  // DELETE this method (lines ~201-204)
  page(_props: Record<string, unknown>): void {
    void _props;
    // No documented page hook in this plugin yet; route-level analytics are not wired here.
  }

  // DELETE this method (lines ~214-217)
  reset(): void {
    // Vendor-specific reset not confirmed; hub reset is handled elsewhere in Task 12.
  }
```

Also remove `track?` from the `CexpInstance` type since it is no longer used:

```typescript
// In the CexpInstance type (~line 36-40), delete the track line:
type CexpInstance = {
  init?: () => void | Promise<void>;
  destroy?: () => void;
  // DELETE: track?: (event: string, props: Record<string, unknown>) => void;
  identify?: (userId: string, traits?: Record<string, unknown>) => void;
};
```

- [x] **Step 4: Run tests**

Run: `npx vitest run test/GamificationPlugin.test.ts`
Expected: All 6 tests pass.

- [x] **Step 5: Commit**

```bash
git add src/plugins/types.ts src/plugins/gamification/GamificationPlugin.ts test/GamificationPlugin.test.ts
git commit -m "refactor: remove track, page, reset from GamificationPlugin and Plugin interface"
```

---

### Task 3: Remove `track()` and `page()` from EventRouter + update `reset()` + tests

**Files:**
- Modify: `src/hub/EventRouter.ts`
- Modify: `test/EventRouter.test.ts`

- [x] **Step 1: Rewrite `test/EventRouter.test.ts`**

Replace the full file. Changes: remove all track/page tests, update `reset` test to only expect onesignal call, simplify the recording plugin helper (no `track`/`page`).

```typescript
import { describe, it, expect } from "vitest";

import { EventRouter } from "../src/hub/EventRouter";
import type { IntegrationToggles } from "../src/types";
import type { HubContext, Plugin } from "../src/plugins/types";

function createRecordingPlugin(name: string) {
  const identifyCalls: Array<{ userId: string; traits?: Record<string, unknown> }> = [];
  let resetCount = 0;

  const plugin: Plugin = {
    name,
    init: () => {},
    onToggle: () => {},
    identify: (userId, traits) => {
      identifyCalls.push({ userId, traits });
    },
    reset: () => {
      resetCount += 1;
    },
  };

  return { plugin, identifyCalls, get resetCount() { return resetCount; } };
}

function ctxWithToggles(getToggles: () => IntegrationToggles): HubContext {
  return {
    getToggles,
    getUserId: () => null,
  };
}

describe("EventRouter", () => {
  it("identify: forwards to onesignal when onesignal is on", () => {
    const toggles: IntegrationToggles = { onesignal: true, gamification: false };
    const { plugin: onesignal, identifyCalls: osIdentify } = createRecordingPlugin("onesignal");
    const { plugin: gamification, identifyCalls: gIdentify } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", onesignal],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("u1", { plan: "pro" });

    expect(osIdentify).toEqual([{ userId: "u1", traits: { plan: "pro" } }]);
    expect(gIdentify).toHaveLength(0);
  });

  it("identify: forwards to gamification when gamification is on", () => {
    const toggles: IntegrationToggles = { onesignal: false, gamification: true };
    const { plugin: onesignal, identifyCalls: osIdentify } = createRecordingPlugin("onesignal");
    const { plugin: gamification, identifyCalls: gIdentify } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", onesignal],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("u2", {});

    expect(osIdentify).toHaveLength(0);
    expect(gIdentify).toEqual([{ userId: "u2", traits: {} }]);
  });

  it("identify: calls both when onesignal and gamification are on", () => {
    const toggles: IntegrationToggles = { onesignal: true, gamification: true };
    const { plugin: onesignal, identifyCalls: osIdentify } = createRecordingPlugin("onesignal");
    const { plugin: gamification, identifyCalls: gIdentify } = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", onesignal],
      ["gamification", gamification],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.identify("user-1", { plan: "pro" });

    expect(osIdentify).toEqual([{ userId: "user-1", traits: { plan: "pro" } }]);
    expect(gIdentify).toEqual([{ userId: "user-1", traits: { plan: "pro" } }]);
  });

  it("reset: calls only onesignal (gamification has no reset)", () => {
    const toggles: IntegrationToggles = { onesignal: true, gamification: true };
    const osRec = createRecordingPlugin("onesignal");
    const gamRec = createRecordingPlugin("gamification");
    const plugins = new Map<string, Plugin>([
      ["onesignal", osRec.plugin],
      ["gamification", gamRec.plugin],
    ]);

    const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
    router.reset();

    expect(osRec.resetCount).toBe(1);
    expect(gamRec.resetCount).toBe(0);
  });
});
```

- [x] **Step 2: Run tests to see failures**

Run: `npx vitest run test/EventRouter.test.ts`
Expected: `"reset: calls only onesignal"` fails because `EventRouter.reset()` still calls gamification.

- [x] **Step 3: Rewrite `src/hub/EventRouter.ts`**

Replace the full file:

```typescript
import type { HubContext, Plugin } from "../plugins/types";

export class EventRouter {
  private readonly ctx: HubContext;
  private readonly plugins: Map<string, Plugin>;

  constructor(args: { ctx: HubContext; plugins: Map<string, Plugin> }) {
    this.ctx = args.ctx;
    this.plugins = args.plugins;
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    const t = this.ctx.getToggles();
    if (t.onesignal) this.plugins.get("onesignal")?.identify?.(userId, traits);
    if (t.gamification) this.plugins.get("gamification")?.identify?.(userId, traits);
  }

  reset(): void {
    const t = this.ctx.getToggles();
    if (t.onesignal) this.plugins.get("onesignal")?.reset?.();
  }
}
```

- [x] **Step 4: Run tests**

Run: `npx vitest run test/EventRouter.test.ts`
Expected: All 4 tests pass.

- [x] **Step 5: Commit**

```bash
git add src/hub/EventRouter.ts test/EventRouter.test.ts
git commit -m "refactor: remove track and page from EventRouter, limit reset to onesignal"
```

---

### Task 4: Remove `track` and `page` from public API

**Files:**
- Modify: `src/types.ts`
- Modify: `src/global.ts`
- Modify: `src/index.ts`
- Modify: `test/global-api.test.ts`
- Modify: `test/control-config-wiring.test.ts`

- [x] **Step 1: Update `test/global-api.test.ts`**

Replace the full file. Changes: remove the test that calls `CExP.track()`; keep `init` and `identify` tests.

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

import { createCExP } from "../src/global";

describe("CExP public surface", () => {
  it("exposes an init function", () => {
    const CExP = createCExP();
    expect(typeof CExP.init).toBe("function");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('script[src*="cexp.fpt.com"]').forEach((el) => el.remove());
    document
      .querySelectorAll("script[src^='https://cdn.jsdelivr.net/npm/cexp-gamification@']")
      .forEach((el) => el.remove());
    delete (globalThis as unknown as { cexp?: unknown }).cexp;
  });

  it("identify after first config resolves does not throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 1,
            integrations: {
              onesignal: { enabled: false },
              gamification: { enabled: false },
            },
          }),
          { status: 200, headers: { "content-type": "application/json", etag: "v1" } },
        ),
      ),
    );

    const CExP = createCExP();
    CExP.init({ id: "sdk-1" });

    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });

    expect(() => CExP.identify("user-42", { plan: "pro" })).not.toThrow();
  });
});
```

- [x] **Step 2: Remove `track` and `page` from `CExPApi` in `src/types.ts`**

Delete these two lines from the `CExPApi` interface:

```typescript
  // DELETE:
  track: (eventName: string, props?: Record<string, unknown>) => void;
  page: (pageProps?: Record<string, unknown>) => void;
```

After removal, `CExPApi` contains: `init`, `identify`, `reset`, `version`.

- [x] **Step 3: Remove `track` and `page` from `src/global.ts`**

Remove `track` and `page` from the `preInitQueue` type union:

```typescript
// BEFORE (lines ~20-25):
  const preInitQueue: Array<
    | { type: "track"; event: string; props: Record<string, unknown> }
    | { type: "page"; props: Record<string, unknown> }
    | { type: "identify"; userId: string; traits?: Record<string, unknown> }
  > = [];

// AFTER:
  const preInitQueue: Array<
    { type: "identify"; userId: string; traits?: Record<string, unknown> }
  > = [];
```

Simplify `enqueueOrRun` — only handles `identify`:

```typescript
// BEFORE (lines ~33-49):
  const enqueueOrRun = (entry: (typeof preInitQueue)[number]) => {
    if (!firstConfigResolved) {
      preInitQueue.push(entry);
      return;
    }

    if (!router || !hub) return;
    if (entry.type === "track") {
      router.track(entry.event, entry.props);
      return;
    }
    if (entry.type === "page") {
      router.page(entry.props);
      return;
    }
    router.identify(entry.userId, entry.traits);
  };

// AFTER:
  const enqueueOrRun = (entry: (typeof preInitQueue)[number]) => {
    if (!firstConfigResolved) {
      preInitQueue.push(entry);
      return;
    }

    if (!router || !hub) return;
    router.identify(entry.userId, entry.traits);
  };
```

Remove `track` and `page` from the `api` object:

```typescript
// DELETE from the api object (lines ~114-126):
    track: (event: unknown, props?: Record<string, unknown>) => {
      requireInit("track");
      const eventName = typeof event === "string" ? event : "unknown_event";
      enqueueOrRun({ type: "track", event: eventName, props: props ?? {} });
    },

    page: (page?: unknown) => {
      requireInit("page");
      const props = (
        typeof page === "object" && page !== null ? page : {}
      ) as Record<string, unknown>;
      enqueueOrRun({ type: "page", props });
    },
```

- [x] **Step 4: Remove `track` and `page` exports from `src/index.ts`**

Delete these two lines:

```typescript
// DELETE:
export const track = CExP.track;
export const page = CExP.page;
```

- [x] **Step 5: Update `test/control-config-wiring.test.ts`**

The test calls `CExP.init()` and waits for a gamification script injection. It doesn't call `track` or `page`, but the config JSON still uses `"onesignal"` (will be renamed in Task 5). No changes needed for this task — the test should still compile and run.

- [x] **Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass (the only pre-existing failure was the removed apiKey-path test in GamificationPlugin; control-config-wiring still tests gamification script injection via CDP-less path and may still fail — that is a pre-existing issue unrelated to this plan).

- [x] **Step 7: Commit**

```bash
git add src/types.ts src/global.ts src/index.ts test/global-api.test.ts
git commit -m "refactor: remove track and page from public CExPApi surface"
```

---

### Task 5: Rename `onesignal` → `notification` across the SDK + remove `void _traits`

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/types.ts`
- Modify: `src/hub/Hub.ts`
- Modify: `src/hub/EventRouter.ts`
- Modify: `src/plugins/onesignal/OneSignalPlugin.ts`
- Modify: `src/global.ts`
- Modify: `test/EventRouter.test.ts`
- Modify: `test/hub-plugin-registry.test.ts`
- Modify: `test/parseControlConfig.test.ts`
- Modify: `test/OneSignalPlugin.test.ts`
- Modify: `test/global-api.test.ts`
- Modify: `test/control-config-wiring.test.ts`
- Modify: `test/GamificationPlugin.test.ts`

- [x] **Step 1: Rename in `src/config/schema.ts`**

Search-and-replace across the file:

| Find | Replace |
|------|---------|
| `"onesignal"` (in `IntegrationKey` union and `INTEGRATION_KEYS` array) | `"notification"` |
| `OneSignalIntegrationToggleConfig` (type name) | `NotificationIntegrationToggleConfig` |
| `IntegrationToggleConfigByKey.onesignal` | `IntegrationToggleConfigByKey.notification` |
| `integrations.onesignal` (in `parseControlConfig`, `tryParseControlConfig`, `areControlConfigsEqual`) | `integrations.notification` |

Specifically these source-level changes:

```typescript
// Line 1:
export type IntegrationKey = "notification" | "gamification";

// Lines 7-12 (rename the type):
export interface NotificationIntegrationToggleConfig extends BasicIntegrationToggleConfig {
  appId?: string;
}

// Lines 38-40:
export interface IntegrationToggleConfigByKey {
  notification: NotificationIntegrationToggleConfig;
  gamification: GamificationIntegrationToggleConfig;
}

// Line 48:
const INTEGRATION_KEYS: IntegrationKey[] = ["notification", "gamification"];

// In parseControlConfig (~line 130, ~144, ~164-169):
//   Replace all `onesignal` with `notification` in:
//   - defaults object
//   - integrations initialization
//   - the else branch that parses appId

// In tryParseControlConfig (~line 199-234):
//   Same replacements

// In areControlConfigsEqual (~line 260):
//   Replace a.integrations.onesignal / b.integrations.onesignal with .notification
```

- [x] **Step 2: Rename in `src/types.ts`**

```typescript
// BEFORE:
export type IntegrationToggles = {
  onesignal: boolean;
  gamification: boolean;
};

// AFTER:
export type IntegrationToggles = {
  notification: boolean;
  gamification: boolean;
};
```

- [x] **Step 3: Rename in `src/hub/Hub.ts`**

Search-and-replace `onesignal` → `notification` in:

```typescript
// DEFAULT_TOGGLES (~line 6):
const DEFAULT_TOGGLES: IntegrationToggles = {
  notification: false,
  gamification: false,
};

// PLUGIN_ORDER (~line 12):
const PLUGIN_ORDER: IntegrationKey[] = ["notification", "gamification"];

// setToggles — integrations object (~line 83):
      integrations: {
        notification: { enabled: next.notification },
        gamification: { enabled: next.gamification },
      },

// setToggles — prev/next toggles (~line 95-96):
        const prevEnabled = prev[integrationKey];
        const enabled = next[integrationKey];
// (these use integrationKey which is now "notification", so no literal change needed)

// deriveTogglesFromControlConfig (~line 235):
    return {
      notification: cfg.integrations.notification.enabled,
      gamification: cfg.integrations.gamification.enabled,
    };
```

- [x] **Step 4: Rename in `src/hub/EventRouter.ts`**

```typescript
// BEFORE:
  identify(userId: string, traits?: Record<string, unknown>): void {
    const t = this.ctx.getToggles();
    if (t.onesignal) this.plugins.get("onesignal")?.identify?.(userId, traits);
    if (t.gamification) this.plugins.get("gamification")?.identify?.(userId, traits);
  }

  reset(): void {
    const t = this.ctx.getToggles();
    if (t.onesignal) this.plugins.get("onesignal")?.reset?.();
  }

// AFTER:
  identify(userId: string, traits?: Record<string, unknown>): void {
    const t = this.ctx.getToggles();
    if (t.notification) this.plugins.get("notification")?.identify?.(userId, traits);
    if (t.gamification) this.plugins.get("gamification")?.identify?.(userId, traits);
  }

  reset(): void {
    const t = this.ctx.getToggles();
    if (t.notification) this.plugins.get("notification")?.reset?.();
  }
```

- [x] **Step 5: Rename `name` in `src/plugins/onesignal/OneSignalPlugin.ts` + remove `void _traits`**

```typescript
// BEFORE (~line 124):
  public readonly name = "onesignal";

// AFTER:
  public readonly name = "notification";

// BEFORE identify method (~line 149-150):
  identify(userId: string, _traits?: Record<string, unknown>): void {
    void _traits;

// AFTER:
  identify(userId: string): void {
```

- [x] **Step 6: Rename in `src/global.ts`**

```typescript
// BEFORE (~line 61-62):
      hub = new Hub({
        pluginOverrides: {
          onesignal: new OneSignalPlugin(),
          gamification: new GamificationPlugin(),
        },
      });

// AFTER:
      hub = new Hub({
        pluginOverrides: {
          notification: new OneSignalPlugin(),
          gamification: new GamificationPlugin(),
        },
      });
```

- [x] **Step 7: Run type check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No errors.

- [x] **Step 8: Update all test files**

In every test file, replace all occurrences of `onesignal` with `notification` in:
- Toggle objects: `{ onesignal: ..., gamification: ... }` → `{ notification: ..., gamification: ... }`
- Plugin names / map keys: `"onesignal"` → `"notification"` (in recording plugin helpers, `new Map` keys, control config JSON)
- Variable names are fine to keep (e.g. `osIdentify` can stay — it's a local name)

Files and specific patterns:

**`test/EventRouter.test.ts`** — toggle objects + Map keys + `createRecordingPlugin("onesignal")` → `createRecordingPlugin("notification")`; also Map key `["onesignal", ...]` → `["notification", ...]`

**`test/hub-plugin-registry.test.ts`** — control config objects `onesignal: { enabled: ... }` → `notification: { enabled: ... }`; plugin name `"onesignal"` → `"notification"`

**`test/OneSignalPlugin.test.ts`** — `hubCtx()` toggle object `onesignal: true` → `notification: true`

**`test/GamificationPlugin.test.ts`** — `hubCtx()` toggle object `onesignal: false` → `notification: false`

**`test/parseControlConfig.test.ts`** — all config objects: `onesignal: { enabled: ... }` → `notification: { enabled: ... }`; expected defaults likewise

**`test/global-api.test.ts`** — config JSON `onesignal: { enabled: false }` → `notification: { enabled: false }`

**`test/control-config-wiring.test.ts`** — config JSON `onesignal: { enabled: false }` → `notification: { enabled: false }`

- [x] **Step 9: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rename onesignal integration key to notification across SDK"
```

---

### Task 6: Remove unused `Hub` methods + final verification

**Files:**
- Modify: `src/hub/Hub.ts`

- [x] **Step 1: Remove `getPlugin()` and `getPluginOrder()` from Hub**

These methods have zero callers in `src/` or `test/`.

```typescript
// DELETE getPlugin (~line 207-209):
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

// DELETE getPluginOrder (~line 227-229):
  getPluginOrder(): string[] {
    return [...PLUGIN_ORDER];
  }
```

- [x] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 3: Run type check + build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: No errors.

- [x] **Step 4: Commit**

```bash
git add src/hub/Hub.ts
git commit -m "refactor: remove unused getPlugin and getPluginOrder from Hub"
```
