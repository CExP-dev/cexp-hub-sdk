# API Namespaces (Integration-owned) Implementation Plan

> **Status: COMPLETED (2026-04).** `CExP.notification.*` and `CExP.gamification.*` namespaces are implemented. This plan is retained as historical reference only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose **integration-owned namespaces** so consumers can see which methods belong to which integration (e.g. `CExP.notification.identify(...)`), while keeping lifecycle stable and preserving top-level `identify/reset` as backwards-compatible fan-out aliases.

**Architecture:** Keep the current runtime wiring (`createCExP` → `Hub` + `EventRouter` + `ControlService`) and add a **thin namespaced facade**:

- `CExP.notification.*` delegates to **notification only** when enabled.
- `CExP.gamification.*` delegates to **gamification only** when enabled.
- Existing `CExP.identify/reset` remain as fan-out routing via `EventRouter` (call enabled integrations).

Implementation strategy:
- Extend `EventRouter` with integration-specific methods.
- In `createCExP()`, implement namespaces by calling those new router methods.
- Do not reach into `hub.getPlugins()` from `global.ts` (keep routing policy centralized).

**Tech Stack:** TypeScript, Vitest, tsup

---

## File Map

| File | Changes |
|------|---------|
| `src/types.ts` | Add integration namespace types (`CExPNotificationApi`, `CExPGamificationApi`, update `CExPApi`) |
| `src/hub/EventRouter.ts` | Add `identifyNotification/identifyGamification/resetNotification/resetGamification` |
| `src/global.ts` | Add `notification`/`gamification` namespaces to returned API |
| `src/index.ts` | Export `notification`/`gamification` namespaces + keep existing exports |
| `src/browser.ts` | No behavioral change; the global singleton now includes namespaces |
| `test/EventRouter.test.ts` | Add tests for new router methods |
| `test/global-api.test.ts` | Add tests for namespace presence + callable behavior after config resolves |
| `README.md` | Update “Public API” to prefer `CExP.notification.*` / `CExP.gamification.*` and remove `track/page` |

---

### Task 1: Define integration namespace types on the public API

**Files:**
- Modify: `src/types.ts`
- Test: `test/global-api.test.ts`

- [ ] **Step 1: Write failing tests for the `notification` namespace**

In `test/global-api.test.ts`, add this test right after `"exposes an init function"`:

```ts
it("exposes a notification namespace with identify/reset", () => {
  const CExP = createCExP();
  expect(CExP.notification).toBeTruthy();
  expect(typeof CExP.notification.identify).toBe("function");
  expect(typeof CExP.notification.reset).toBe("function");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run test/global-api.test.ts`  
Expected: FAIL because `CExP.notification` does not exist yet.

- [ ] **Step 3: Update `src/types.ts`**

Replace `src/types.ts` with:

```ts
export type InitOptions = { id: string };

export type IntegrationToggles = {
  notification: boolean;
  gamification: boolean;
};

export interface CExPNotificationApi {
  identify: (userId: string) => void;
  reset: () => void;
}

export interface CExPGamificationApi {
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
}

export interface CExPApi {
  // Stable lifecycle
  init: (options: InitOptions) => void;
  version: string;

  // Backwards-compatible fan-out routing (existing behavior)
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;

  // Integration-owned namespaces (preferred)
  notification: CExPNotificationApi;
  gamification: CExPGamificationApi;
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`  
Expected: FAIL in `src/global.ts` because `createCExP()` doesn’t return the new namespace fields yet.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts test/global-api.test.ts
git commit -m "feat: add integration-owned namespaces to CExPApi types"
```

---

### Task 2: Add integration-specific methods to `EventRouter`

**Files:**
- Modify: `src/hub/EventRouter.ts`
- Test: `test/EventRouter.test.ts`

- [ ] **Step 1: Write failing tests for `EventRouter` integration methods**

In `test/EventRouter.test.ts`, append these tests to the end of the file:

```ts
it("identifyNotification: forwards only to notification when enabled", () => {
  const toggles: IntegrationToggles = { notification: true, gamification: true };
  const notif = createRecordingPlugin("notification");
  const gam = createRecordingPlugin("gamification");
  const plugins = new Map<string, Plugin>([
    ["notification", notif.plugin],
    ["gamification", gam.plugin],
  ]);

  const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
  router.identifyNotification("u1");

  expect(notif.identifyCalls).toEqual([{ userId: "u1", traits: undefined }]);
  expect(gam.identifyCalls).toHaveLength(0);
});

it("identifyGamification: forwards only to gamification when enabled", () => {
  const toggles: IntegrationToggles = { notification: true, gamification: true };
  const notif = createRecordingPlugin("notification");
  const gam = createRecordingPlugin("gamification");
  const plugins = new Map<string, Plugin>([
    ["notification", notif.plugin],
    ["gamification", gam.plugin],
  ]);

  const router = new EventRouter({ ctx: ctxWithToggles(() => toggles), plugins });
  router.identifyGamification("u2", { plan: "pro" });

  expect(notif.identifyCalls).toHaveLength(0);
  expect(gam.identifyCalls).toEqual([{ userId: "u2", traits: { plan: "pro" } }]);
});
```

- [ ] **Step 2: Run tests to see failures**

Run: `npx vitest run test/EventRouter.test.ts`  
Expected: FAIL with `identifyNotification is not a function` / `identifyGamification is not a function`.

- [ ] **Step 3: Implement router methods**

In `src/hub/EventRouter.ts`, add these methods to the `EventRouter` class (keep existing `identify()` and `reset()` unchanged):

```ts
  identifyNotification(userId: string): void {
    const t = this.ctx.getToggles();
    if (!t.notification) return;
    this.plugins.get("notification")?.identify?.(userId);
  }

  identifyGamification(userId: string, traits?: Record<string, unknown>): void {
    const t = this.ctx.getToggles();
    if (!t.gamification) return;
    this.plugins.get("gamification")?.identify?.(userId, traits);
  }

  resetNotification(): void {
    const t = this.ctx.getToggles();
    if (!t.notification) return;
    this.plugins.get("notification")?.reset?.();
  }

  resetGamification(): void {
    const t = this.ctx.getToggles();
    if (!t.gamification) return;
    this.plugins.get("gamification")?.reset?.();
  }
```

- [ ] **Step 4: Run router tests**

Run: `npx vitest run test/EventRouter.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hub/EventRouter.ts test/EventRouter.test.ts
git commit -m "feat: add integration-specific routing methods to EventRouter"
```

---

### Task 3: Add `CExP.notification` and `CExP.gamification` namespaces to `createCExP()`

**Files:**
- Modify: `src/global.ts`
- Test: `test/global-api.test.ts`

- [x] **Step 1: Write a failing “callable after config resolves” test**

In `test/global-api.test.ts`, add this test:

```ts
it("notification.identify after first config resolves does not throw", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          version: 1,
          integrations: {
            notification: {
              enabled: true,
              appId: "00000000-0000-0000-0000-000000000000",
            },
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

  expect(() => CExP.notification.identify("user-42")).not.toThrow();
});
```

- [x] **Step 2: Run tests to verify failure**

Run: `npx vitest run test/global-api.test.ts`  
Expected: FAIL because `CExP.notification` isn’t implemented yet (and/or types don’t match).

- [x] **Step 3: Implement namespaces in `src/global.ts`**

In `src/global.ts`, extend the `api: CExPApi = { ... }` object with:

```ts
    notification: {
      identify: (identity: unknown) => {
        requireInit("notification.identify");
        if (typeof identity !== "string" || identity.length === 0) return;
        if (!firstConfigResolved) return;
        router?.identifyNotification(identity);
      },
      reset: () => {
        requireInit("notification.reset");
        if (!firstConfigResolved) return;
        router?.resetNotification();
      },
    },

    gamification: {
      identify: (identity: unknown, traits?: Record<string, unknown>) => {
        requireInit("gamification.identify");
        if (typeof identity !== "string" || identity.length === 0) return;
        if (!firstConfigResolved) return;
        router?.identifyGamification(identity, traits);
      },
      reset: () => {
        requireInit("gamification.reset");
        if (!firstConfigResolved) return;
        router?.resetGamification();
      },
    },
```

Rules:
- Namespaced methods must throw before `init` (use `requireInit`).
- Namespaced methods must be safe no-ops before first config resolves (do not introduce new queue entries).
- Actual plugin selection stays in `EventRouter`.

- [x] **Step 4: Run typecheck + tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run test/global-api.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/global.ts test/global-api.test.ts
git commit -m "feat: add CExP.notification and CExP.gamification namespaces"
```

---

### Task 4: Export namespaces from the ESM entry

**Files:**
- Modify: `src/index.ts`

- [x] **Step 1: Export `notification` and `gamification`**

In `src/index.ts`, add:

```ts
export const notification = CExP.notification;
export const gamification = CExP.gamification;
```

- [x] **Step 2: Run typecheck + tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export integration namespaces from ESM entry"
```

---

### Task 5: Update README docs to match the new namespaced shape

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update “Public API”**

In `README.md`, replace the “Public API” section with:

```md
## Public API

Supported surface for application code (preferred integration namespaces):

- `CExP.init({ id })`
- `CExP.notification.identify(userId)`
- `CExP.notification.reset()`
- `CExP.gamification.identify(userId, traits?)`
- `CExP.gamification.reset()`
- `CExP.version` — hub package version (from `package.json` for that build)

Backwards-compatible aliases (fan-out routing across enabled integrations):

- `CExP.identify(userId, traits?)`
- `CExP.reset()`
```

Update the routing table to remove `track/page` and clarify:
- `identify/reset` = fan-out
- `notification.*` = notification only
- `gamification.*` = gamification only

- [ ] **Step 2: Prettier check**

Run: `npx prettier -c README.md`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document integration-owned API namespaces"
```

---

## Self-Review

**1. Spec coverage:** Matches the expected consumer snippet: `CExP.init(...)` then `CExP.notification.identify(...)`. Keeps `CExP.identify/reset` for backwards compatibility.

**2. Placeholder scan:** No placeholders; every step includes concrete code and exact commands.

**3. Type consistency:** Types (`src/types.ts`), router methods (`EventRouter`), and facade (`createCExP`) use consistent method names and signatures.

---

Plan updated and saved to `docs/superpowers/plans/2026-04-07-api-namespaces.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
