# Hybrid Version Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a hybrid version-management workflow so the SDK stays evergreen for consumers while backend control config can safely update supported vendor integration parameters without requiring consumers to change their snippet.

**Architecture:** Extend the remote control JSON schema to carry optional per-integration configuration fields (initially **gamification** remote knobs: `packageVersion`, `apiKey`). Wire that per-integration config from `ControlService` → `Hub` → `plugin.init(ctx, config)` and reinitialize the enabled gamification plugin when its config changes. Also remove version drift by deriving `CExP.version` from `package.json` at build time.

**Tech Stack:** TypeScript, tsup, Vitest + jsdom, the existing `ControlService`/`Hub`/plugin architecture.

---

### Task 1: Make `CExP.version` a single source of truth

**Files:**
- Modify: `/home/long/cexp-hub-sdk/src/global.ts`
- Create: `/home/long/cexp-hub-sdk/test/version.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";

describe("CExP.version", () => {
  it("is derived from package.json (not hardcoded)", async () => {
    vi.resetModules();
    vi.doMock("../package.json", () => ({ default: { version: "9.9.9" } }));

    const mod = await import("../src/index");

    expect(mod.CExP.version).toBe("9.9.9");
    vi.unmock("../package.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/version.test.ts -v`
Expected: FAIL before implementation (because `CExP.version` is currently hardcoded).

- [ ] **Step 3: Implement minimal change**

In `src/global.ts`, replace the hardcoded `DEFAULT_VERSION = "0.1.0"` with build-time import from `package.json`:

```ts
import packageJson from "../package.json";
const DEFAULT_VERSION = (packageJson as { version?: string }).version ?? "0.0.0";
```

Note: use the JSON import approach (not a bundler `define`/codegen-only value) so `test/version.test.ts` can mock `package.json` reliably.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/version.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/global.ts test/version.test.ts
git commit -m "chore: derive SDK version from package.json"
```

---

### Task 2: Extend control config schema to carry optional integration config

**Files:**
- Modify: `/home/long/cexp-hub-sdk/src/config/schema.ts`
- Modify: `/home/long/cexp-hub-sdk/test/parseControlConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test case verifying that `parseControlConfig` preserves allowed optional fields for **gamification**:

```ts
it("preserves allowed per-integration config fields for remote overrides", () => {
  const parsed = parseControlConfig({
    version: 2,
    integrations: {
      gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k_123" },
      identity: { enabled: false }
    },
  });

  expect(parsed).toEqual({
    version: 2,
    integrations: {
      gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k_123" },
      snowplow: { enabled: false },
      onesignal: { enabled: false },
      identity: { enabled: false },
    },
  });
});
```

And add one more test verifying invalid `packageVersion` strings are ignored (fallback to plugin defaults instead of being used to construct a script URL):

```ts
it("ignores invalid gamification.packageVersion inputs", () => {
  const parsed = parseControlConfig({
    version: 1,
    integrations: {
      gamification: { enabled: true, packageVersion: "1.0.0/evil", apiKey: "k_123" },
      identity: { enabled: false },
    },
  });

  expect(parsed.integrations.gamification).toEqual({ enabled: true, apiKey: "k_123" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parseControlConfig.test.ts -v`
Expected: FAIL (current schema drops optional fields).

- [ ] **Step 3: Implement minimal schema parsing**

Update `src/config/schema.ts`:

1. Extend `IntegrationToggleConfig` to include optional remote fields:
   - `gamification`: `packageVersion?: string; apiKey?: string`
   - `identity` / other integrations: leave as `{ enabled: boolean }` only (remote knobs in this implementation pass are **gamification-only**).
2. Update `parseControlConfig()` to parse gamification optional fields safely:
   - `apiKey`: accept non-empty string.
   - `packageVersion`: accept string matching a safe allowlist regex that disallows `/` and whitespace (e.g. `/^[0-9A-Za-z][0-9A-Za-z+._-]*$/`) and enforce a max length (e.g. 64–128 chars). `packageVersion` is interpolated only into a single jsDelivr version *segment* (`...@<segment>/dist/...`) on a fixed host, so it can’t change the host/path prefix beyond that segment.
   - If invalid, ignore the field (do not reject the whole control payload).
3. Update `tryParseControlConfig()` similarly: keep strictness for required structural fields (`version` number, `integrations` plain object, `integrations.*.enabled` boolean), but treat invalid optional gamification fields as ignored (fallback to hub/plugin defaults).
4. Ensure `parseControlConfig()` still ignores unknown keys and still never throws.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parseControlConfig.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/parseControlConfig.test.ts
git commit -m "feat: preserve per-integration config in control JSON"
```

---

### Task 3: Make config-change detection include optional fields

**Files:**
- Modify: `/home/long/cexp-hub-sdk/src/config/schema.ts`
- Modify: `/home/long/cexp-hub-sdk/test/ControlService.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test ensuring `ControlService` calls `onUpdate` when a supported per-integration config field changes even if `enabled` booleans stay the same.

Example scenario: `gamification.enabled=true` stays true, but `packageVersion` changes.

```ts
it("calls onUpdate when integration config changes but enabled toggles stay the same", async () => {
  const body1 = {
    version: 1,
    integrations: {
      gamification: { enabled: true, packageVersion: "1.0.1-beta.9", apiKey: "k1" },
      snowplow: { enabled: false },
      onesignal: { enabled: false },
      identity: { enabled: false },
    },
  };

  const body2 = {
    version: 1, // keep config version the same to prove we compare optional fields too
    integrations: {
      gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k1" },
      snowplow: { enabled: false },
      onesignal: { enabled: false },
      identity: { enabled: false },
    },
  };

  fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v1"', body: body1 }) as any);
  fetchMock.mockResolvedValueOnce(mockFetchResponse({ status: 200, etag: '"v2"', body: body2 }) as any);

  const svc = new ControlService({ controlUrl, onUpdate: updateSpy });

  await svc.syncOnce();
  await svc.syncOnce();

  expect(updateSpy).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ControlService.test.ts -v`
Expected: FAIL (because `areControlConfigsEqual` only compares `version` + `enabled` booleans).

- [ ] **Step 3: Implement minimal equality update**

Update `areControlConfigsEqual()` in `src/config/schema.ts` to include comparison of:
- `gamification`: `packageVersion`, `apiKey`

Rules:
- If `gamification.enabled` is false, you may skip comparing its optional config fields (optional: but safe).
- Unknown keys remain ignored.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ControlService.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/ControlService.test.ts
git commit -m "feat: detect control config changes for remote vendor knobs"
```

---

### Task 4: Wire integration config into Hub → plugin init; reinit on config changes

**Files:**
- Modify: `/home/long/cexp-hub-sdk/src/hub/Hub.ts`
- Modify: `/home/long/cexp-hub-sdk/src/global.ts`
- Modify: `/home/long/cexp-hub-sdk/test/hub-plugin-registry.test.ts`
- Modify: `/home/long/cexp-hub-sdk/test/global-api.test.ts` (if needed)

- [ ] **Step 1: Write the failing test**

In `test/hub-plugin-registry.test.ts`, add a test that verifies:
1) `plugin.init(ctx, config)` receives config from the control JSON for its integration.
2) When the integration remains enabled but its config changes, Hub reinitializes that plugin by calling `onToggle(false)` then `onToggle(true)`.

Sketch:

```ts
it("reinitializes plugin when enabled config changes", async () => {
  const onToggle = vi.fn();
  const init = vi.fn();

  const gamificationPlugin: Plugin = {
    name: "gamification",
    init: (_ctx, config) => {
      init(config);
    },
    onToggle,
  };

  const hub = new Hub({
    pluginOverrides: { gamification: gamificationPlugin },
    anonymousId: "anon-1",
  });

  const c1: ControlConfig = {
    version: 1,
    integrations: {
      snowplow: { enabled: false },
      onesignal: { enabled: false },
      gamification: { enabled: true, packageVersion: "1.0.1-beta.9", apiKey: "k1" },
      identity: { enabled: false },
    },
  };

  const c2: ControlConfig = {
    version: 1,
    integrations: {
      ...c1.integrations,
      gamification: { enabled: true, packageVersion: "1.0.1-beta.10", apiKey: "k1" },
    },
  };

  await hub.setControlConfig(c1);
  await hub.setControlConfig(c2);

  // init called at least once during first setControlConfig
  expect(init).toHaveBeenCalled();

  // config-change reinit should disable + re-enable
  expect(onToggle.mock.calls).toContainEqual([false]);
  expect(onToggle.mock.calls).toContainEqual([true]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hub-plugin-registry.test.ts -v`
Expected: FAIL (Hub currently has no `setControlConfig` and always calls `plugin.init(ctx, {})`).

- [ ] **Step 3: Implement wiring in Hub**

Implementation in `src/hub/Hub.ts`:

1. Introduce `setControlConfig(next: ControlConfig): Promise<void>` as the **only** method that triggers plugin initialization (avoid initializing with `{}`).
2. Store `currentControlConfig` and derive `currentToggles` from it.
3. On first `setControlConfig`:
   - call `plugin.init(ctx, next.integrations?.[integrationKey] ?? { enabled: false })` for all plugins **before** calling any `plugin.onToggle(true)`.
4. On subsequent `setControlConfig`:
   - If `enabled` changed:
     - For `gamification` transitions `false -> true`: call `plugin.init(ctx, next.integrations?.gamification ?? { enabled: false })` first (await if needed), then call `plugin.onToggle(true)`.
     - For other enable/disable transitions: call `plugin.onToggle(newEnabled)`.
   - If `gamification.enabled` is `true` in both old/new and (`packageVersion`/`apiKey`) changed:
     - call `plugin.init(ctx, next.integrations?.gamification ?? { enabled: false })` to update the plugin cfg
     - call `plugin.onToggle(false)` then `plugin.onToggle(true)` so gamification reloads the vendor script for the new `packageVersion`.
   - If `gamification.enabled` is `false`, you may update the gamification plugin cfg via `init()` without toggling (so the next enable uses the latest cfg).

Notes:
- Keep `ctx.getToggles()` returning a live reference/function as today (tests depend on “live” toggles).
- If any `plugin.init()` returns a Promise, ensure its completion happens before `onToggle(true)` (especially for reinitialization paths).
- Preserve plugin init order determinism (existing `PLUGIN_ORDER`).

- [ ] **Step 4: Implement wiring in `src/global.ts`**

Update the `applyConfig()` inner function to call:
`await hub.setControlConfig(controlService.getConfig()!)`

Also keep SPA page view enabling/disabling based on `config.integrations.snowplow.enabled`.

Avoid using the old `hub.setToggles()` path for initialization so plugins never receive `{}` as their init config.

Because `setControlConfig` is async, make `applyConfig()` async and invoke it from `ControlService`’s `onUpdate` as `void applyConfig();` to avoid blocking fetch polling.

To avoid overlapping control updates, serialize config application (e.g. in `global.ts`, chain updates through a single in-flight promise so newer updates never run concurrently with older ones).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hub/Hub.ts src/global.ts test/hub-plugin-registry.test.ts test/global-api.test.ts
git commit -m "feat: pass remote integration config to plugins"
```

---

### Task 5: Add integration config contract coverage (schema ↔ wiring)

**Files:**
- Modify: `/home/long/cexp-hub-sdk/test/global-api.test.ts` (optional additions)
- Create (optional): `/home/long/cexp-hub-sdk/test/control-config-wiring.test.ts`

Test hygiene: if a test suite adds jsDelivr script injection, extend cleanup to remove `cdn.jsdelivr.net/npm/cexp-gamification@.../dist/cexp-web-sdk.js` script tags and clear `globalThis.cexp`.

- [ ] **Step 1: Write the failing test**

Add one smoke-level test that:
- stubs fetch to return `gamification.enabled=true` with a valid `packageVersion` override **and** a non-empty `apiKey`,
- verifies the gamification plugin attempts to load the expected jsDelivr URL (by inspecting injected `script[src*="cexp-gamification@<version>"]`).

If it’s too brittle to verify actual script loading (jsdom won’t fire external `onload`), just verify that the correct `<script>` tag is injected with the expected `src`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/global-api.test.ts -v`
Expected: FAIL (before wiring, config wasn’t passed; gamification uses defaults).

- [ ] **Step 3: Implement minimal wiring support**

If needed, adjust wiring so integration config blocks are passed into plugin.init before plugin enable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/global-api.test.ts test/control-config-wiring.test.ts
git commit -m "test: cover remote integration config wiring"
```

---

### Task 6: Update consumer/ops docs for the hybrid version-management rules

**Files:**
- Modify: `/home/long/cexp-hub-sdk/docs/superpowers/guides/consumer-integration-guideline.md`
- Modify: `/home/long/cexp-hub-sdk/README.md`

- [ ] **Step 1: Write the failing test**

Documentation change: no code test required.

- [ ] **Step 2: Run doc validation**

Run: `npm run lint`
Expected: PASS (TypeScript-only lint; ensure no formatting breaks).

- [ ] **Step 3: Implement minimal doc updates**

Add a short section:
- “What is evergreen”: consumers never change the script.
- “What changes with vendor updates”: backend control config can update safe integration knobs (e.g. gamification `packageVersion`), while hub-pinned script host/path changes require a new hub release.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/guides/consumer-integration-guideline.md
git commit -m "docs: explain hybrid version-management rollout"
```

---

## Plan completion notes

- This plan focuses on **remote integration knobs** that can be expressed through existing plugin `init()` config parsing.
- For vendor changes that require script URL/path changes (e.g. fixed snowplow/identity/onesignal scripts in this repo), a new `cexp-hub-sdk` release is still required per the hybrid design.

