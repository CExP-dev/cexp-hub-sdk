# CExP Hub (Unified Browser SDK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single browser SDK (`window.CExP`) that consumers integrate with a script tag plus `CExP.init({ id: sdkId })`; all analytics, push, identity (`fpt_uuid`), and gamification go through the hub — never direct `Snowplow` / `OneSignal` / vendor globals. Consumers integrate once; the SDK stays evergreen and behavior is governed by backend toggles (consumers never update their snippet).

**Architecture:** A small **facade** (`CExP`) loads remote **control + integration config** keyed by `sdkId`, maintains **toggle state** (polled every 5 minutes with conditional GETs), and dispatches events to **internal plugins** (identity, Snowplow, OneSignal, gamification). All four plugins have independent **toggles**. Plugins are **lazy-loaded** when their toggle transitions to enabled and **destroyed + removed from the DOM** when toggled off. A **pre-init queue** captures all calls (`track`, `page`, `identify`) made before the first config fetch resolves; once config is known, queued calls are flushed through the normal routing pipeline. **Snowplow handles all event enrichment** (URL, referrer, UA, etc.) — there is no separate ContextEnricher in the hub. **End users** are distinct from **consumers**: anonymous id is canonical `fpt_uuid` (from `cdp.js`, a Segment Analytics.js fork used only as an identity layer with its event pipeline disabled); known users via `CExP.identify(userId, traits)`.

**Key integrations:**

| Integration | Source | Role in Hub |
| --- | --- | --- |
| Identity (`cdp.js`) | `https://octopus-stream01-cads.fpt.vn/cdp.js` | Segment Analytics.js 3.x fork (`window.cdpFpt`). **Identity layer only**: `fpt_uuid` generation, localStorage + cookie persistence, backend sync (`/analytics/sync_user`), cross-domain resolution. **Event pipeline disabled** — must not send to `/analytics/t`, `/p`, `/i` endpoints. |
| Tracking (Snowplow) | Self-hosted tracker at `https://cexp.fpt.com/sdk/acti/cdp.js` | All event tracking. `trackSelfDescribingEvent` for `CExP.track()`, `trackPageView` for `CExP.page()`. `fpt_uuid` + `userId`/`traits` passed as custom context entity. Collector: `octopus-stream01-cads.fpt.vn`, postPath: `/com.fpt/t`. |
| Notifications (OneSignal) | `https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js` | Web push. Uses OneSignalDeferred init pattern. |
| Gamification | `https://cdn.jsdelivr.net/npm/cexp-gamification@1.0.1-beta.9/dist/cexp-web-sdk.js` | In-house gamification SDK (`window.cexp`). |

**Tech Stack:** TypeScript, tsup (bundler), Vitest + jsdom (tests), optional Playwright for smoke.

**Related spec:** No separate committed spec file yet — requirements are consolidated in this plan.

---

## Requirements snapshot (must not regress)

| Area | Rule |
| --- | --- |
| Consumer integration | Paste script + `CExP.init({ id: sdkId })` only. |
| Public API | Only `window.CExP`; **no** `Snowplow.*`, `OneSignal.*`, `window.cexp`, `window.cdpFpt` in consumer code. |
| Remote config | Single endpoint returns **toggles + per-integration non-secret config** resolved by `sdkId`. |
| Control refresh | Poll every **5 minutes**; use **ETag** / **If-Modified-Since**; on fetch failure, **keep last good** toggles. |
| Integrate once (evergreen snippet) | Consumers never update the script; config contract is backwards compatible; unknown fields ignored. |
| Lazy load per integration | Vendor scripts injected only when toggle transitions to enabled. |
| Toggle off → DOM removal | When toggled off: call `destroy()`, **remove `<script>` tag from DOM**, clean up globals where possible. |
| Pre-init queue | All `track`/`page`/`identify` calls before first config fetch completes are **queued**, then flushed once toggles are known. |
| No ContextEnricher | Snowplow handles all enrichment (URL, referrer, UA, timestamps). Non-Snowplow plugins receive only the raw consumer payload. |
| `anonymousId` | Canonical **`fpt_uuid`** from `cdp.js`; persist **localStorage + cookie** fallback. |
| `identify` | `CExP.identify(userId, traits)` — does **not** call Snowplow's `setUserId()`; `userId` + `traits` are passed in the `fpt_uuid` custom context entity only. |
| `reset` | Clear user + traits; **retain** `fpt_uuid`. |
| SPA `page_view` | Hub auto-detects via `history.pushState`/`replaceState` + `popstate`; consumer can also call `CExP.page()` explicitly for custom page names. |
| Identity off | `cdp.js` not loaded; `fpt_uuid` not generated/synced; cross-domain disabled; script removed from DOM. |
| Tracking (Snowplow) off | Snowplow tracker not loaded; **queue `identify`** (max 50, 30 min TTL); **drop** `track` + `page`; script removed from DOM. |
| OneSignal off | OneSignal SDK not loaded/removed; clear subscription/user association via vendor API; script removed from DOM. |
| Gamification off | Gamification SDK not loaded/removed; drop gamification calls; script removed from DOM. |

---

## File structure

### Current (Tasks 1–7 implemented)

```
cexp-hub-sdk/
  package.json
  package-lock.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  .gitignore
  README.md
  src/
    index.ts                 # ESM entry; CExP singleton + named exports
    browser.ts               # IIFE entry; attaches CExP to globalThis
    global.ts                # createCExP() factory (stubs — not yet wired to Hub)
    types.ts                 # InitOptions, IntegrationToggles, CExPApi
    config/
      schema.ts              # parseControlConfig, ControlConfig types
    hub/
      Hub.ts                 # Plugin registry, toggle diffs, HubContext
      ControlService.ts      # Fetch + ETag + 5m polling
      EventRouter.ts         # Snowplow queue/drop rules
      ContextEnricher.ts     # ⚠ DEPRECATED — remove in Task 12
      IdentityStore.ts       # fpt_uuid read/write (cdpFpt → ls → cookie → uuid v4)
    plugins/
      types.ts               # Plugin, HubContext interfaces
      snowplow/
        SnowplowPlugin.ts    # Test stub (records calls — replace in Task 9)
      identity/
        CdpIdentityPlugin.ts # Loads cdp.js, fpt_uuid sync
  test/
    global-api.test.ts
    parseControlConfig.test.ts
    ControlService.test.ts
    hub-plugin-registry.test.ts
    EventRouter.test.ts
    ContextEnricher.test.ts  # ⚠ Remove with ContextEnricher
    IdentityStore.test.ts
    CdpIdentityPlugin.test.ts
```

### Planned additions (Tasks 8–14)

```
  src/
    hub/
      SpaPageView.ts               # Task 8
    plugins/
      onesignal/
        OneSignalPlugin.ts         # Task 10
      gamification/
        GamificationPlugin.ts      # Task 11
  examples/                        # Optional smoke-test HTML
  .github/workflows/ci.yml         # Task 14
```

**Build outputs:** ESM + IIFE bundle for CDN (`cexp-hub.min.js`) exposing `window.CExP`.

---

## Completed tasks

### Task 1: Repository scaffold ✓

- [x] `package.json` (`cexp-hub-sdk`, `type: module`, scripts: `build`, `test`, `lint`)
- [x] devDependencies: `typescript`, `tsup`, `vitest`, `@types/node`, `jsdom`
- [x] `tsconfig.json` (strict, ES2022, DOM, `noEmit: true` — emit via tsup only)
- [x] `tsup.config.ts` — dual build: ESM from `src/index.ts`, IIFE from `src/browser.ts` with global `CExP`
- [x] `vitest.config.ts` with jsdom environment
- [x] Build succeeds

### Task 2: Public types and global CExP shape ✓

- [x] `InitOptions { id: string }`
- [x] `CExPApi` interface: `init`, `track`, `page`, `identify`, `reset`, `getAnonymousId`, `version`
- [x] `createCExP()` in `global.ts` with init-guard stubs
- [x] `browser.ts` IIFE entry attaches to `globalThis.CExP`
- [x] Test: `createCExP` has `init` function

> **Note:** `track`/`page`/`identify` are stubs in `global.ts` — wiring to Hub / EventRouter / plugins happens in Task 12.

### Task 3: Remote config + control service ✓

- [x] `parseControlConfig` with safe defaults; `tryParseControlConfig` strict; `areControlConfigsEqual`
- [x] `ControlService`: fetch with `If-None-Match` / ETag; 304 keeps previous; 200 updates
- [x] `startPolling(300_000)` with overlap guard
- [x] Tests: 304, 200, errors, polling guard

### Task 4: Plugin interface and registry ✓

- [x] `Plugin` interface: `name`, `init`, `destroy?`, `onToggle`, `track?`, `page?`, `identify?`, `reset?`
- [x] `HubContext`: `getToggles()`, `getAnonymousId()`, `getUserId()`
- [x] `Hub` holds plugin map; `setToggles` drives `onToggle` diffs; registers plugins in order: `snowplow` → `onesignal` → `identity` → `gamification`
- [x] Tests: toggle calls, init, live toggles

### Task 5: Event router + Snowplow queue rules ✓

- [x] Snowplow off → `identify` queued (max 50, 30 min TTL); `track` / `page` dropped
- [x] Snowplow on → queue flushed FIFO, then live forwarding
- [x] Tests: queue, flush, max size, TTL (fake timers)

### Task 6: Context enrichment ✓ (deprecated)

- [x] `ContextEnricher.enrich()` adds `pageUrl`, `path`, `referrer`, `locale`, `userAgent`, `timestamp`
- [x] Merge policy: user props win over defaults
- [x] Tests passing

> **Decision:** ContextEnricher is **redundant** — Snowplow handles all enrichment natively, and non-Snowplow plugins receive only the raw consumer payload. **Remove `ContextEnricher.ts` + `ContextEnricher.test.ts` in Task 12.**

### Task 7: Identity — `fpt_uuid` (CdpIdentityPlugin) ✓

- [x] `IdentityStore.getOrCreateFptUuid()`: reads from `window.cdpFpt`, then localStorage/cookie mirrors (`fpt_uuid` / `cexp_fpt_uuid`), then UUID v4 fallback
- [x] Persists to `cexp_fpt_uuid` in localStorage + cookie
- [x] `CdpIdentityPlugin`: lazy-loads `cdp.js` on toggle-on; polls for `cdpFpt` readiness; calls `IdentityStore`
- [x] Tests: script injection, timeouts, retries, persistence

> **Gap:** `cdpFpt` event pipeline is not yet disabled — `cdp.js` may still send to its own `/analytics/*` endpoints. Fix in Task 12.

---

## Remaining tasks

### Task 8: SPA auto page view ✓

**Files:**

- Create: `src/hub/SpaPageView.ts`
- Modify: `src/hub/Hub.ts`

- [x] **Step 1:** Patch `history.pushState` / `replaceState` once; listen `popstate`.
- [x] **Step 2:** Debounce 50–100ms; call internal `page()` with current `location.pathname` + `document.title`.
- [x] **Step 3:** Consumer can also call `CExP.page(customProps)` explicitly for custom page names — the SPA hook and explicit calls must coexist without double-firing.
- [x] **Step 4:** Test with mocked history (verify `page` invoked on pushState; verify explicit `CExP.page()` works).
- [ ] **Step 5:** Commit: `feat: SPA page_view auto capture`

---

### Task 9: Snowplow plugin (real implementation) ✓

**Files:**

- Modify: `src/plugins/snowplow/SnowplowPlugin.ts` (replace test stub with real implementation)
- Modify: `test/EventRouter.test.ts` (update for real plugin if needed)

**Snowplow tracker setup** (performed inside the plugin on toggle-on):

```js
// 1. Inject self-hosted Snowplow tracker
// <script src="https://cexp.fpt.com/sdk/acti/cdp.js" async></script>

// 2. Create tracker
window.snowplow("newTracker", "sp1", collectorUrl, {
  appId: appIdFromRemoteConfig,
  platform: "web",
  encodeBase64: true,
  post: true,
  postPath: "/com.fpt/t",
});

// 3. Enable activity tracking
window.snowplow("enableActivityTracking", {
  minimumVisitLength: 5,
  heartbeatDelay: 10,
});
```

**API mapping:**

| CExP method | Snowplow API |
| --- | --- |
| `CExP.track(eventName, props)` | `trackSelfDescribingEvent({ schema, data })` with `fpt_uuid` custom context entity |
| `CExP.page()` | `trackPageView()` with `fpt_uuid` custom context entity |
| `CExP.identify(userId, traits)` | **Not** `setUserId()` — update the custom context entity to include `userId` + `traits`; subsequent events carry the enriched entity |

**Custom context entity** (attached to every Snowplow event):

```js
{
  schema: "iglu:com.fpt/cexp_identity/jsonschema/1-0-0", // see open points
  data: {
    fpt_uuid: "<from IdentityStore>",
    userId: "<from CExP.identify, or null>",
    traits: { /* from CExP.identify */ }
  }
}
```

- [x] **Step 1:** On toggle-on: inject Snowplow tracker script from `https://cexp.fpt.com/sdk/acti/cdp.js`; wait for `window.snowplow` global.
- [x] **Step 2:** Call `newTracker` with collector URL + config from remote config (`appId`, `postPath`, etc.).
- [x] **Step 3:** Call `enableActivityTracking`.
- [x] **Step 4:** Implement `track()` → `trackSelfDescribingEvent()` with `fpt_uuid` custom context entity.
- [x] **Step 5:** Implement `page()` → `trackPageView()` with `fpt_uuid` custom context entity.
- [x] **Step 6:** Implement `identify()` → store `userId` + `traits` in plugin state; subsequent events include them in the custom context entity.
- [x] **Step 7:** On toggle-off: call `destroy()`, **remove tracker `<script>` from DOM**, clear `window.snowplow` reference.
- [x] **Step 8:** Test: script injection, API mapping, context entity attachment, toggle-off cleanup.
- [ ] **Step 9:** Commit: `feat: Snowplow plugin with self-hosted tracker`

---

### Task 10: OneSignal plugin ✓

**Files:**

- Create: `src/plugins/onesignal/OneSignalPlugin.ts`
- Create: `test/OneSignalPlugin.test.ts`

OneSignalDeferred embed pattern (used internally by the plugin, not by consumer):

```html
<script
  src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
  defer
></script>
<script>
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function (OneSignal) {
    await OneSignal.init({
      appId: `${onesignal_app_id}`,
    });
  });
</script>
```

- [x] **Step 1:** On toggle-on: inject `OneSignalSDK.page.js` script, initialize via `OneSignalDeferred` with `appId` from remote config.
- [x] **Step 2:** On `identify(userId)`: associate user with OneSignal (`setExternalUserId` or equivalent).
- [x] **Step 3:** On toggle-off: call vendor APIs to **logout / clear user** / tags; **remove `<script>` from DOM**; clean up `window.OneSignalDeferred`.
- [x] **Step 4:** Test with mocked OneSignal global.
- [ ] **Step 5:** Commit: `feat: OneSignal plugin`

---

### Task 11: Gamification plugin ✓

**Files:**

- Create: `src/plugins/gamification/GamificationPlugin.ts`
- Create: `test/GamificationPlugin.test.ts`

- [x] **Step 1:** On toggle-on: inject `cexp-web-sdk.js` (version from remote config); instantiate `new window.cexp({ apiKey: fromRemote })` and call `init()` inside the plugin.
- [x] **Step 2:** Forward relevant `track` / `identify` signals if gamification API supports them; otherwise no-op forwarding until API is confirmed.
- [x] **Step 3:** On toggle-off: call teardown if supported; **remove `<script>` from DOM**; clean up `window.cexp` reference.
- [x] **Step 4:** Test with mocked `window.cexp` global.
- [ ] **Step 5:** Commit: `feat: gamification plugin wrapper`

---

### Task 12: Hub facade wiring ✓

**Files:**

- Modify: `src/global.ts` — wire `createCExP()` to Hub / ControlService / EventRouter / plugins
- Modify: `src/hub/Hub.ts` — connect IdentityStore, wire `getAnonymousId()` to `fpt_uuid`
- Modify: `src/hub/EventRouter.ts` — extend to route to all four plugins (not just Snowplow)
- Modify: `src/plugins/identity/CdpIdentityPlugin.ts` — disable `cdpFpt` event pipeline
- Delete: `src/hub/ContextEnricher.ts`
- Delete: `test/ContextEnricher.test.ts`

**Sub-tasks:**

- [x] **Step 1: Pre-init queue.** In `Hub` or `global.ts`, queue all `track`/`page`/`identify` calls before the first `ControlService` config fetch resolves. Once config arrives and plugins are initialized, flush the queue through the EventRouter.

- [x] **Step 2: Wire `CExP.init()`.** `init({ id })` → start `ControlService` → first config fetch → apply toggles → lazy-load enabled plugins → start SPA hooks → start 5m polling. All inside `global.ts`, delegating to `Hub`.

- [x] **Step 3: Wire `CExP.track/page/identify/reset`.** Route through `Hub` → `EventRouter` → enabled plugins. No direct vendor API calls from consumer code.

- [x] **Step 4: Wire `getAnonymousId()`.** `Hub.getAnonymousId()` → `IdentityStore.getOrCreateFptUuid()` (replace the current `Math.random` stub in `global.ts`).

- [x] **Step 5: Extend EventRouter for all plugins.** Currently only routes to Snowplow. Extend to route `identify`/`reset` to all enabled plugins, `track` to Snowplow + gamification, `page` to Snowplow.

- [x] **Step 6: Disable `cdpFpt` event pipeline.** When `CdpIdentityPlugin` loads `cdp.js`, configure `cdpFpt` so it does **not** send events to its own `/analytics/*` endpoints (e.g. initialize with `{ 'Segment.io': false }` or equivalent). Only the identity/user API should be active.

- [x] **Step 7: Remove ContextEnricher.** Delete `src/hub/ContextEnricher.ts` and `test/ContextEnricher.test.ts`. Remove any imports. Snowplow handles enrichment; non-Snowplow plugins receive raw payload.

- [x] **Step 8: End-to-end test.** Write integration test: `CExP.init()` → mock config fetch → `track`/`page`/`identify` reach the correct plugins based on toggles.

- [ ] **Step 9:** Commit: `feat: wire Hub facade to CExP`

---

### Task 13: Documentation and CDN publishing notes ✓

**Files:**

- Modify: `README.md`

- [x] **Step 1:** Document **only** `CExP.init({ id })`, `CExP.track`, `CExP.identify`, `CExP.reset`, `CExP.page`.
- [x] **Step 2:** Explicit **"Do not use Snowplow / OneSignal / cexp / cdpFpt globals"** section.
- [x] **Step 3:** Build instructions and jsdelivr / npm publish version path.
- [ ] **Step 4:** Commit: `docs: consumer integration guide`

---

### Task 14: CI and quality gate

**Files:**

- Create: `.github/workflows/ci.yml` (optional)
- Create: `eslint.config.js` (optional)

- [ ] **Step 1:** CI runs `npm test` + `npm run build`.
- [ ] **Step 2:** Commit: `ci: test and build workflow`

---

## Open points (resolve during implementation)

1. **Exact backend URL** for `sdkId` config + toggles (replace placeholder in `ControlService`).
2. **Stable config contract** field names for each integration block (unknown fields ignored; missing fields use safe defaults).
3. **Iglu schema for `fpt_uuid` custom context entity** — needs a schema registered in the Iglu registry (e.g. `iglu:com.fpt/cexp_identity/jsonschema/1-0-0`). Define and register before Snowplow plugin can send self-describing events.
4. **Iglu schema ownership for consumer events** — `CExP.track(eventName, props)` maps to `trackSelfDescribingEvent` which requires an Iglu schema per event type. Decide whether schemas are defined by FPT in a shared Iglu registry, or consumers must provide their own schema URIs.
5. **Gamification SDK public methods** — confirm what methods are available beyond `init()` for user binding and event forwarding.
6. **`cdpFpt` event pipeline disabling** — verify the correct approach (e.g. `initialize({}, { 'Segment.io': false })` or `initialize({ initialPageview: false })`) with the in-house cdp.js fork.

---

## Execution handoff

Plan complete and saved to [`docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md`](docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md).

**Two execution options:**

1. **Subagent-driven (recommended)** — Use superpowers:subagent-driven-development: fresh subagent per task, review between tasks.

2. **Inline execution** — Use superpowers:executing-plans: batch tasks with checkpoints.

Which approach do you want when you are ready to implement?
