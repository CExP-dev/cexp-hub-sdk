# Remove Identity + Snowplow Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use @superpowers/subagent-driven-development (recommended) or @superpowers/executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `identity` (cdp.js / `fpt_uuid`) and `snowplow` plugins and all hub wiring, types, and tests that exist only to support them, leaving **OneSignal** and **gamification** as the only integrations.

**Architecture:** Drop `snowplow` and `identity` from `IntegrationKey`, control config parsing, `Hub`’s plugin registry order, and `ControlService.getToggles()`. Rewrite `EventRouter` so `track` / `identify` / `reset` delegate only to **onesignal** and **gamification**; remove the Snowplow-specific **identify queue** and the rule that dropped `track`/`page` when Snowplow was off. Remove `IdentityStore` and **public** `CExP.getAnonymousId()` (they existed for anonymous id + Snowplow context). Stop auto-enabling SPA debounced `page` callbacks from `global.ts` (they existed to feed Snowplow `trackPageView`); keep `Hub.enableSpaPageView` / `SpaPageView` for optional future use, but `applyConfig` should not subscribe based on removed toggles. `CExP.page()` may remain as a public API that forwards to `router.page()` (no-op for gamification today).

**Tech Stack:** TypeScript, Vitest (`npm test`), `tsc` (`npm run lint`).

**Prerequisites (recommended):** @superpowers/brainstorming for any product ambiguity; @superpowers/using-git-worktrees for an isolated branch/worktree.

---

## File structure (ownership after change)

| File | Responsibility |
|------|----------------|
| `src/config/schema.ts` | Only `onesignal` + `gamification` in `IntegrationKey`, `INTEGRATION_KEYS`, `ControlConfig.integrations`, defaults, `parseControlConfig` / `tryParseControlConfig` / `areControlConfigsEqual`. |
| `src/types.ts` | `IntegrationToggles` with two booleans only; remove `getAnonymousId` from `CExPApi`. |
| `src/hub/Hub.ts` | `PLUGIN_ORDER`: `["onesignal", "gamification"]`; `DEFAULT_TOGGLES`; `setToggles` / `deriveTogglesFromControlConfig`; `getContext()` without `getAnonymousId` (keep `getUserId` stub for OneSignal). |
| `src/hub/ControlService.ts` | `getToggles()` return type omits removed keys. |
| `src/hub/EventRouter.ts` | Route `track` → gamification when on; `page` → gamification `page` (noop today); `identify` → onesignal + gamification; `reset` → onesignal + gamification; **delete** queue helpers and `IDENTIFY_QUEUE_*` exports or repurpose tests. |
| `src/global.ts` | Register only `OneSignalPlugin` + `GamificationPlugin`; remove SPA enablement tied to Snowplow; remove `getAnonymousId` from returned API. |
| `src/plugins/types.ts` | `HubContext`: remove `getAnonymousId` (OneSignal keeps `getUserId`). |
| **Delete** | `src/plugins/snowplow/`, `src/plugins/identity/`, `src/hub/IdentityStore.ts`, `test/SnowplowPlugin.test.ts`, `test/CdpIdentityPlugin.test.ts`, `test/IdentityStore.test.ts`. |
| `src/plugins/gamification/GamificationPlugin.ts` | Update comment on `page()` that references Snowplow. |

**Docs:** Do not bulk-edit `docs/superpowers/**` in the same pass unless the user asks; optional follow-up is listed at the end.

---

## Behavioral rules (post-change)

1. **`track`:** If `gamification` toggle is on, call `gamification.track`; otherwise no-op.
2. **`page`:** If `gamification` toggle is on, call `gamification.page` (currently no-op implementation); otherwise no-op. No Snowplow `trackPageView`.
3. **`identify`:** If `onesignal` on → `onesignal.identify`; if `gamification` on → `gamification.identify`. No queue when a plugin is off.
4. **`reset`:** Call `onesignal.reset` / `gamification.reset` when respective toggles are on.
5. **SPA:** `global.ts` `applyConfig` should **not** call `hub.enableSpaPageView` based on config (remove Snowplow gate); call `hub.disableSpaPageView()` or simply never enable after load so automatic history-based page events are off.

---

### Task 1: Types + control schema (breaking contract)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config/schema.ts`
- Test: `test/parseControlConfig.test.ts`, `test/control-config-wiring.test.ts`

- [x] **Step 1: Write failing tests** — In `parseControlConfig.test.ts`, assert that parsed `integrations` has **only** `onesignal` and `gamification` keys (or that `IntegrationToggles` / defaults no longer reference snowplow/identity). Adjust existing cases that expect `snowplow` / `identity` fields.

- [x] **Step 2: Run tests**

Run: `npm test -- test/parseControlConfig.test.ts`
Expected: FAIL until schema updated.

- [x] **Step 3: Implement** — Remove `"snowplow"` and `"identity"` from `IntegrationKey`, `INTEGRATION_KEYS`, `IntegrationToggleConfigByKey`, and all default objects in `parseControlConfig`, `tryParseControlConfig`, `areControlConfigsEqual`. In `src/types.ts`, set:

```ts
export type IntegrationToggles = {
  onesignal: boolean;
  gamification: boolean;
};
```

Remove `getAnonymousId?` from `CExPApi`.

- [x] **Step 4: Run tests + lint**

Run: `npm test -- test/parseControlConfig.test.ts test/control-config-wiring.test.ts`
Run: `npm run lint`
Expected: PASS (fix wiring test fixtures in same commit if needed).

- [x] **Step 5: Commit**

```bash
git add src/types.ts src/config/schema.ts test/parseControlConfig.test.ts test/control-config-wiring.test.ts
git commit -m "refactor(config): drop snowplow and identity from control schema"
```

---

### Task 2: Hub + ControlService toggle wiring

**Files:**
- Modify: `src/hub/Hub.ts`
- Modify: `src/hub/ControlService.ts`
- Test: `test/hub-plugin-registry.test.ts`, `test/hub-spa-page-view.test.ts`

- [x] **Step 1: Update Hub** — `PLUGIN_ORDER` → `["onesignal", "gamification"]`. `DEFAULT_TOGGLES` two keys. `setToggles` / `deriveTogglesFromControlConfig` / `currentControlConfig` integrations omit removed keys. Remove `import { IdentityStore }`. In `getContext()`, remove `getAnonymousId`; keep:

```ts
getToggles: () => this.currentToggles ?? DEFAULT_TOGGLES,
getUserId: () => null,
```

(Adjust if `HubContext` still requires a shape change in Task 3.)

- [x] **Step 2: Update ControlService.getToggles()** — Return type and object with only `onesignal` and `gamification`.

- [x] **Step 3: Fix tests** — Replace toggle objects in `hub-plugin-registry.test.ts` and `hub-spa-page-view.test.ts` (remove `snowplow`, `identity` from `setToggles` calls). Update plugin override keys in registry tests.

- [x] **Step 4: Run**

Run: `npm test -- test/hub-plugin-registry.test.ts test/hub-spa-page-view.test.ts`
Run: `npm run lint`

- [x] **Step 5: Commit**

```bash
git add src/hub/Hub.ts src/hub/ControlService.ts test/hub-plugin-registry.test.ts test/hub-spa-page-view.test.ts
git commit -m "refactor(hub): two-plugin registry and remove anonymous id from context"
```

---

### Task 3: Plugin `HubContext` surface

**Files:**
- Modify: `src/plugins/types.ts`
- Test: `test/OneSignalPlugin.test.ts`, `test/GamificationPlugin.test.ts`, `test/EventRouter.test.ts` (temporary skip until Task 4 if needed)

- [x] **Step 1: Remove `getAnonymousId` from `HubContext`** in `src/plugins/types.ts` (update JSDoc).

- [x] **Step 2: Update test mocks** — Remove `getAnonymousId` from manual `HubContext` objects in `OneSignalPlugin.test.ts` and `GamificationPlugin.test.ts`.

- [x] **Step 3: Run**

Run: `npm test -- test/OneSignalPlugin.test.ts test/GamificationPlugin.test.ts`
Run: `npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/plugins/types.ts test/OneSignalPlugin.test.ts test/GamificationPlugin.test.ts
git commit -m "refactor(plugins): drop HubContext.getAnonymousId"
```

---

### Task 4: EventRouter rewrite + tests

**Files:**
- Modify: `src/hub/EventRouter.ts`
- Modify: `test/EventRouter.test.ts` (replace Snowplow-queue suite)

- [x] **Step 1: New tests first** — Replace `EventRouter.test.ts` with cases such as:
  - `track` with gamification off → gamification `track` not called (use recording mock plugin).
  - `track` with gamification on → `track` called.
  - `identify` with onesignal on → onesignal `identify` called; same for gamification.
  - `reset` calls enabled plugins only.

Use a small `createRecordingPlugin(name)` helper and a minimal `HubContext` mock with `getToggles()` returning the scenario toggles.

- [x] **Step 2: Run tests**

Run: `npm test -- test/EventRouter.test.ts`
Expected: FAIL until router updated.

- [x] **Step 3: Implement `EventRouter`** — Remove `identifyQueue`, `flushIdentifyQueue`, `enqueueIdentify`, `pruneIdentifyQueue`, and exports `IDENTIFY_QUEUE_MAX_SIZE` / `IDENTIFY_QUEUE_TTL_MS` (grep repo for usages first; `global-api.test.ts` may reference queue behavior).

Example skeleton:

```ts
track(event: string, props?: Record<string, unknown>): void {
  if (this.ctx.getToggles().gamification) {
    this.plugins.get("gamification")?.track?.(event, props ?? {});
  }
}

page(props?: Record<string, unknown>): void {
  if (this.ctx.getToggles().gamification) {
    this.plugins.get("gamification")?.page?.(props ?? {});
  }
}

identify(userId: string, traits?: Record<string, unknown>): void {
  const t = this.ctx.getToggles();
  if (t.onesignal) this.plugins.get("onesignal")?.identify?.(userId, traits);
  if (t.gamification) this.plugins.get("gamification")?.identify?.(userId, traits);
}

reset(): void {
  const t = this.ctx.getToggles();
  if (t.onesignal) this.plugins.get("onesignal")?.reset?.();
  if (t.gamification) this.plugins.get("gamification")?.reset?.();
}
```

- [x] **Step 4: Run full test suite** (may still fail on other files).

Run: `npm test`
Run: `npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/hub/EventRouter.ts test/EventRouter.test.ts
git commit -m "refactor(router): route events to onesignal and gamification only"
```

---

### Task 5: `global.ts` facade

**Files:**
- Modify: `src/global.ts`

- [x] **Step 1: Remove** imports of `CdpIdentityPlugin`, `SnowplowPlugin`.

- [x] **Step 2: `pluginOverrides`** — only `onesignal` and `gamification`.

- [x] **Step 3: `applyConfig`** — Remove the block that enables SPA page view when `config.integrations.snowplow.enabled`. After `setControlConfig`, call `hub.disableSpaPageView()` (or omit `enableSpaPageView` entirely so SPA is never auto-subscribed).

- [x] **Step 4: Remove `getAnonymousId`** from the `api` object.

- [x] **Step 5: Run**

Run: `npm test`
Run: `npm run lint`

- [x] **Step 6: Commit**

```bash
git add src/global.ts
git commit -m "refactor(global): register two plugins and remove SPA/snowplow wiring"
```

---

### Task 6: Delete plugins, IdentityStore, and dedicated tests

**Files:**
- Delete: `src/plugins/snowplow/SnowplowPlugin.ts`
- Delete: `src/plugins/identity/CdpIdentityPlugin.ts`
- Delete: `src/hub/IdentityStore.ts`
- Delete: `test/SnowplowPlugin.test.ts`, `test/CdpIdentityPlugin.test.ts`, `test/IdentityStore.test.ts`
- Modify: `src/plugins/gamification/GamificationPlugin.ts` (comment on `page()`)

- [x] **Step 1: Delete files** listed above.

- [x] **Step 2: Gamification** — Replace Snowplow mention in `page()` with neutral wording (e.g. analytics not wired in this plugin).

- [x] **Step 3: Run**

Run: `npm test`
Run: `npm run lint`

- [x] **Step 4: Commit**

```bash
git add -A src/plugins/snowplow src/plugins/identity src/hub/IdentityStore.ts test/SnowplowPlugin.test.ts test/CdpIdentityPlugin.test.ts test/IdentityStore.test.ts src/plugins/gamification/GamificationPlugin.ts
git commit -m "chore: remove snowplow and identity plugins and IdentityStore"
```

---

### Task 7: Remaining tests and ControlService integration tests

**Files:**
- Modify: `test/global-api.test.ts`, `test/ControlService.test.ts`, any other failing files from `npm test`

- [x] **Step 1: Rewrite `global-api.test.ts`** — Remove Snowplow global mock and assertions on `newTracker` / `trackSelfDescribingEvent`. Replace with a scenario that fits the new stack (e.g. mock fetch returning config with gamification on and assert gamification path, or simplify to init + `identify` routing to mocks). Remove references to `snowplow` / `identity` in config payloads.

- [x] **Step 2: Update `ControlService.test.ts`** — `makeControlBody` and assertions: drop `snowplow` / `identity` fields; align with `tryParseControlConfig` strict shape (only two non-gamification keys + gamification).

- [x] **Step 3: Grep** — `rg 'snowplow|identity' test src` and fix stragglers.

- [x] **Step 4: Run**

Run: `npm test`
Run: `npm run lint`
Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add test/global-api.test.ts test/ControlService.test.ts
git commit -m "test: align integration tests with two-plugin hub"
```

---

### Task 8: Optional documentation pass (user-triggered)

- [ ] Update `README.md` and consumer guideline bullets that mention `Snowplow`, `cdp.js`, or four integrations — **only if** the user requests doc updates in this repo.

---

## Plan review loop (@writing-plans)

1. After drafting, run a focused review: completeness of file list, ordering (schema before Hub before Router), and whether any **grep** targets were missed (`snowplow`, `identity`, `IdentityStore`, `getAnonymousId`, `CEXP_IDENTITY`, `fpt_uuid`).
2. If review finds gaps, update this document and re-review.
3. If approved, hand off to execution (see below).

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-03-remove-identity-snowplow-plugins.md`. Two execution options:**

**1. Subagent-driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** @superpowers/subagent-driven-development.

**2. Inline execution** — Run tasks in one session with checkpoints. **REQUIRED SUB-SKILL:** @superpowers/executing-plans.

**Which approach do you want?**
