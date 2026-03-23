# CExP Hub (Unified Browser SDK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single browser SDK (`window.CExP`) that consumers integrate with a script tag plus `CExP.init({ id: sdkId })`; all analytics, push, identity (`fpt_uuid`), and gamification go through the hub—never direct `Snowplow` / `OneSignal` / vendor globals. Consumers integrate once; the SDK stays evergreen and behavior is governed by backend toggles (so consumers never need to update their snippet).

**Architecture:** A small **facade** (`CExP`) loads remote **control + integration config** keyed by `sdkId`, maintains **toggle state** (polled every 5 minutes with conditional GETs), and dispatches enriched events to **internal plugins** (Snowplow, OneSignal, cdp.js identity, cexp-gamification). Plugins are loaded and activated **lazily per integration** when toggles indicate enabled. Plugins are registered inside the package; the public API is only `CExP.*`. **End users** are distinct from **consumers**: anonymous id is canonical `fpt_uuid` (localStorage + cookie fallback); known users via `CExP.identify(userId, traits)`.

**Tech Stack:** TypeScript, bundler (recommend **tsup** or **rollup**), Vitest (or Jest) for unit tests, optional Playwright for smoke. Snowplow browser tracker, OneSignal Web SDK (loaded dynamically), in-house scripts: [`cdp.js`](https://octopus-stream01-cads.fpt.vn/cdp.js), gamification [`cexp-web-sdk.js`](https://cdn.jsdelivr.net/npm/cexp-gamification@1.0.1-beta.9/dist/cexp-web-sdk.js) (version pinned in hub).

**Related spec:** No separate committed spec file yet—requirements are consolidated in this plan. If you add `docs/superpowers/specs/YYYY-MM-DD-cexp-hub-sdk-design.md`, link it here.

---

## Requirements snapshot (must not regress)

| Area | Rule |
|------|------|
| Consumer integration | Paste script + `CExP.init({ id: sdkId })` only; `sdkId` identifies the consumer to your backend. |
| Public API | Only `window.CExP` (or global export); **no** `Snowplow.*`, `OneSignal.*`, `window.cexp` / `cdpFpt` in consumer docs. |
| Remote config | **Single round-trip recommended:** backend returns **toggles + per-integration non-secret config** resolved by `sdkId` (toggles-only JSON is insufficient if consumer never passes keys—use one response or two coordinated endpoints). |
| Control refresh | Fixed base URL; poll every **5 minutes**; use **ETag** / **If-Modified-Since**; on fetch failure, **keep last good** toggles. |
| Integrate once (evergreen snippet) | Consumers never update the script after initial integration; config contract must be backwards compatible indefinitely and unknown config keys are ignored. |
| Lazy load per integration | Vendor scripts are injected only when the corresponding integration toggle transitions to enabled; toggled-off integrations stop outbound integration traffic (with your chosen queue/drop/teardown rules). |
| `anonymousId` | Canonical **`fpt_uuid`**; persist **localStorage + cookie** fallback. |
| `identify` | `userId` + optional `traits` object. |
| `reset` | Clear user + traits; **retain** `fpt_uuid`. |
| SPA `page_view` | Auto on route change: wrap `history.pushState` / `replaceState` + `popstate`. |
| Snowplow off | **Queue identify only**; **drop** `track` + `page_view` until re-enabled. |
| OneSignal off | **Clear** subscription / external user association per vendor API. |
| Gamification off | **Drop** gamification calls immediately; load gamification script when integration enabled (lazy). |

---

## File structure (greenfield)

Create a standard TS library layout:

```
cexp-hub-sdk/
  package.json
  tsconfig.json
  tsup.config.ts (or rollup.config.mjs)
  src/
    index.ts                 # entry; attach global CExP in UMD/IIFE build
    global.ts                # window.CExP bootstrap
    types.ts                 # public types (InitOptions, Traits, etc.)
    hub/
      Hub.ts                 # facade orchestrator
      EventRouter.ts         # track/page/identify routing + queue rules
      ContextEnricher.ts     # url, referrer, locale, ua, timestamps
      ControlService.ts      # fetch + poll + ETag cache
      IdentityStore.ts       # fpt_uuid read/write (ls + cookie)
      SpaPageView.ts         # history hooks
    plugins/
      types.ts               # Plugin interface
      snowplow/
        SnowplowPlugin.ts
      onesignal/
        OneSignalPlugin.ts
      identity/
        CdpIdentityPlugin.ts # loads cdp.js, exposes fpt_uuid sync
      gamification/
        GamificationPlugin.ts # loads cexp-web-sdk, wraps window.cexp
    config/
      schema.ts              # validate remote JSON (zod or manual)
  test/
    hub.test.ts
    ControlService.test.ts
    EventRouter.test.ts
    ...
```

**Build outputs:** ESM + IIFE bundle for CDN (`cexp-hub.min.js`) exposing `window.CExP`.

---

## Task 1: Repository scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`, `README.md` (stub)
- Create: `src/index.ts` (empty export)

- [ ] **Step 1:** Initialize `package.json` with `name` (e.g. `@cexp/hub` or `cexp-hub`), `type: module`, scripts: `build`, `test`, `lint`.
- [ ] **Step 2:** Add devDependencies: `typescript`, `tsup`, `vitest`, `@types/node` (and `jsdom` or `happy-dom` if testing DOM).
- [ ] **Step 3:** Add `tsconfig.json` (strict, `src` root).
- [ ] **Step 4:** Add minimal `tsup.config.ts` targeting `src/index.ts`, formats `esm` + `iife` with global name `CExP` for IIFE.
- [ ] **Step 5:** Run `npm install` and `npm run build`; expect empty bundle or placeholder export.
- [ ] **Step 6:** Commit: `chore: scaffold cexp-hub-sdk package`

---

## Task 2: Public types and global `CExP` shape

**Files:**
- Create: `src/types.ts`
- Create: `src/global.ts`
- Modify: `src/index.ts`

- [ ] **Step 1:** Define `InitOptions { id: string }` (extend later with optional `env`, `debug`).
- [ ] **Step 2:** Define `CExPApi`: `init`, `track`, `page`, `identify`, `reset`, `getAnonymousId` (optional internal), `version`.
- [ ] **Step 3:** In `global.ts`, implement `createCExP(): CExPApi` returning no-op or throw-before-init stubs.
- [ ] **Step 4:** Export `CExP` as default for IIFE global attachment in `index.ts` (`globalThis.CExP = createCExP()` for browser build only—use tsup `define` or separate entry).
- [ ] **Step 5:** Write test: importing API object has `init` function.

```ts
// test/global-api.test.ts
import { describe, it, expect } from 'vitest';
import { createCExP } from '../src/global';

it('exposes init', () => {
  const CExP = createCExP();
  expect(typeof CExP.init).toBe('function');
});
```

Run: `npx vitest run test/global-api.test.ts` — PASS after implementation.

- [ ] **Step 6:** Commit: `feat: add CExP public surface and types`

---

## Task 3: Remote config + control service

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/hub/ControlService.ts`
- Test: `test/ControlService.test.ts`

**Contract (adjust URL to your backend):**

- `GET https://<fixed-host>/v1/sdk-config?sdkId=<id>` returns JSON:
  - `version: number`
  - `integrations: { snowplow?: { enabled, ... }, onesignal?: { enabled, ... }, gamification?: { enabled, ... }, identity?: { enabled, ... } }`
  - Each enabled integration may include **non-secret** fields (collector URL, OneSignal app id, gamification script version pin, etc.).

- [ ] **Step 1:** Write failing test: mock `fetch` returns 304 with no body → `ControlService` keeps previous state.
- [ ] **Step 2:** Implement `ControlService`: first fetch stores `etag`; subsequent requests send `If-None-Match`; 304 → no state change.
- [ ] **Step 3:** Test: 200 with new body updates toggles and emits callback.
- [ ] **Step 4:** Implement `startPolling(intervalMs = 300_000)` using `setInterval` + guard for overlapping requests.
- [ ] **Step 5:** Commit: `feat: control service with ETag and 5m polling`

---

## Task 4: Plugin interface and registry

**Files:**
- Create: `src/plugins/types.ts`
- Create: `src/hub/EventRouter.ts` (skeleton)

```ts
// src/plugins/types.ts (illustrative)
export interface HubContext {
  getToggles(): IntegrationToggles;
  getAnonymousId(): string | null;
  getUserId(): string | null;
}

export interface Plugin {
  name: string;
  init(ctx: HubContext, config: unknown): Promise<void> | void;
  destroy?(): void;
  onToggle(enabled: boolean): void;
  track?(event: string, props: Record<string, unknown>): void;
  page?(props: Record<string, unknown>): void;
  identify?(userId: string, traits?: Record<string, unknown>): void;
  reset?(): void;
}
```

- [ ] **Step 1:** Define types in `types.ts` / `plugins/types.ts`.
- [ ] **Step 2:** `Hub` holds `Map<string, Plugin>` and registers plugins in fixed order.
- [ ] **Step 3:** Test: toggling plugin calls `onToggle(false)` then `onToggle(true)`.

- [ ] **Step 4:** Commit: `feat: plugin registry and lifecycle`

---

## Task 5: Event router + Snowplow queue rules

**Files:**
- Modify: `src/hub/EventRouter.ts`
- Create: `src/plugins/snowplow/SnowplowPlugin.ts` (stub)

**Rules:**

- When Snowplow **disabled**: `identify` → **queue** (max size + TTL—document constants, e.g. max 50, 30 min); `track` / `page` → **drop**.
- When Snowplow **enabled**: flush identify queue in order, then process live events.

- [ ] **Step 1:** Unit test: Snowplow off → `track` not forwarded; `identify` queued.
- [ ] **Step 2:** Unit test: Snowplow on → queue flushed then new `track` works.
- [ ] **Step 3:** Implement `EventRouter` delegating to `SnowplowPlugin` stub that records calls for tests.
- [ ] **Step 4:** Commit: `feat: event router with Snowplow identify queue`

---

## Task 6: Context enrichment

**Files:**
- Create: `src/hub/ContextEnricher.ts`
- Test: `test/ContextEnricher.test.ts`

- [ ] **Step 1:** In jsdom, set `window.location`, `document.referrer`; enricher adds `pageUrl`, `path`, `referrer`, `locale`, `userAgent`, `timestamp`.
- [ ] **Step 2:** Merge with user payload; do not overwrite explicit user keys (define merge policy).
- [ ] **Step 3:** Commit: `feat: context enrichment`

---

## Task 7: Identity — `fpt_uuid` (CdpIdentityPlugin)

**Files:**
- Create: `src/hub/IdentityStore.ts`
- Create: `src/plugins/identity/CdpIdentityPlugin.ts`

- [ ] **Step 1:** Lazy-load `cdp.js` via dynamic script injection once when identity integration is enabled by remote toggles.
- [ ] **Step 2:** Read `fpt_uuid` from same storage keys / APIs `cdp.js` uses; fallback: generate UUID v4 only if spec requires (prefer always from cdp after load).
- [ ] **Step 3:** Persist mirror in **localStorage + cookie** (namespaced keys, e.g. `cexp_fpt_uuid`) for hub consistency if cdp is slow.
- [ ] **Step 4:** Test with mocked `window.cdpFpt` / storage (integration test optional).
- [ ] **Step 5:** Commit: `feat: identity plugin and fpt_uuid storage`

---

## Task 8: SPA auto page view

**Files:**
- Create: `src/hub/SpaPageView.ts`
- Modify: `src/hub/Hub.ts`

- [ ] **Step 1:** Patch `history.pushState` / `replaceState` once; listen `popstate`.
- [ ] **Step 2:** Debounce 50–100ms; call internal `page()` with enriched path/title.
- [ ] **Step 3:** Test with mocked history (verify `page` invoked on pushState).
- [ ] **Step 4:** Commit: `feat: SPA page_view auto capture`

---

## Task 9: Snowplow plugin (real)

**Files:**
- Modify: `src/plugins/snowplow/SnowplowPlugin.ts`

- [ ] **Step 1:** Lazy-load/initialize Snowplow tracker only when Snowplow integration toggle is enabled (no consumer keys in HTML).
- [ ] **Step 2:** Map `CExP.track` / `page` / `identify` to Snowplow APIs.
- [ ] **Step 3:** Manual smoke in example HTML page (optional folder `examples/`).
- [ ] **Step 4:** Commit: `feat: Snowplow plugin integration`

---

## Task 10: OneSignal plugin

**Files:**
- Create: `src/plugins/onesignal/OneSignalPlugin.ts`

- [ ] **Step 1:** Lazy-load OneSignal using the OneSignalDeferred pattern (inject `OneSignalSDK.page.js` and then `OneSignal.init({ appId })` only when `onesignal.enabled` is true).
- [ ] **Step 2:** On toggle **off**: call vendor APIs to **logout / clear user** / tags as supported.
- [ ] **Step 3:** On toggle **on**: init with app id from remote config; link `userId` on `identify`.
- [ ] **Step 4:** Commit: `feat: OneSignal plugin`

OneSignalDeferred embed pattern (used internally by the plugin):

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

---

## Task 11: Gamification plugin

**Files:**
- Create: `src/plugins/gamification/GamificationPlugin.ts`

- [ ] **Step 1:** Lazy-load `cexp-web-sdk.js` when gamification integration toggle is enabled (pin version from remote config).
- [ ] **Step 2:** Instantiate `new window.cexp({ apiKey: fromRemote })` and `init()` **inside plugin only**.
- [ ] **Step 3:** Forward relevant `track` / identity signals only if gamification API is documented; otherwise no-op `track` forwarding until API is confirmed.
- [ ] **Step 4:** On toggle off: stop forwarding; if library supports teardown, call it.
- [ ] **Step 5:** Commit: `feat: gamification plugin wrapper`

---

## Task 12: Hub facade wiring

**Files:**
- Create: `src/hub/Hub.ts`
- Modify: `src/global.ts`

- [ ] **Step 1:** `init({ id })` starts `ControlService`, resolves toggles/config, instantiates core hub services and SPA hooks; plugins are **lazy-loaded/activated** per enabled integration.
- [ ] **Step 2:** `track`, `page`, `identify`, `reset` call `EventRouter` + `IdentityStore` / plugins per toggles.
- [ ] **Step 3:** Throw or no-op with warning if `init` not called (choose one; document).
- [ ] **Step 4:** Commit: `feat: wire Hub facade to CExP`

---

## Task 13: Documentation and CDN publishing notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Document **only** `CExP.init({ id })`, `CExP.track`, `CExP.identify`, `CExP.reset`, `CExP.page` (if public).
- [ ] **Step 2:** Explicit **“Do not use Snowplow/OneSignal/cexp globals”** section.
- [ ] **Step 3:** Build instructions and jsdelivr / npm publish version path (`/cexp-hub@1/...`).
- [ ] **Step 4:** Commit: `docs: consumer integration guide`

---

## Task 14: CI and quality gate

**Files:**
- Create: `.github/workflows/ci.yml` (optional)
- Create: `eslint.config.js` (optional)

- [ ] **Step 1:** CI runs `npm test` + `npm run build`.
- [ ] **Step 2:** Commit: `ci: test and build workflow`

---

## Open points (resolve during implementation)

1. **Exact backend URL** for `sdkId` config + toggles (replace placeholder in `ControlService`).
2. **Stable config contract** field names for each integration block (no schemaVersion; unknown fields ignored; missing fields use safe defaults).
3. **Gamification** obfuscated bundle — confirm public methods for user binding if beyond `init()`.

---

## Execution handoff

Plan complete and saved to [`docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md`](docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md).

**Two execution options:**

1. **Subagent-driven (recommended)** — Use superpowers:subagent-driven-development: fresh subagent per task, review between tasks.

2. **Inline execution** — Use superpowers:executing-plans: batch tasks with checkpoints.

**Optional:** Run plan-document-reviewer subagent against this file + future spec for a consistency pass before coding.

Which approach do you want when you are ready to implement?
