# Unified control config implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy `{ version, integrations }` control JSON with the unification `modules[]` wire format, normalize to an extended `ControlConfig`, and pass full OneSignal `init` options (with numeric `delay` coercion) while preserving gamification validation and ETag-driven updates.

**Architecture:** Add a dedicated parser for the unified wire shape (`version` string, optional `sdkId`, `modules` with `NOTIFICATION` / `GAMIFICATION` and `property` blobs). Map first matching module per type; invalid `property` disables only that integration. Internally keep `ControlConfig.integrations.{notification,gamification}` with `enabled` plus typed fields so `Hub` and plugins stay aligned. Coerce `delay.pageViews` / `delay.timeDelay` inside `promptOptions` to finite numbers before `OneSignal.init`. Extend `Hub` so notification config changes while enabled trigger re-init (parity with gamification).

**Tech Stack:** TypeScript, Vitest, existing `tsup` build; no new runtime dependencies.

---

## File map (create / modify)


| Path                                                                 | Role                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/schema.ts`                                               | Types (`ControlConfig.version` → `string`, optional `sdkId`; extend `NotificationIntegrationToggleConfig` with OneSignal-related optional fields); gamification types unchanged except usage; `areControlConfigsEqual`; **remove** legacy `parseControlConfig` / old `tryParseControlConfig` **or** keep thin wrappers — prefer **single** `tryParseControlConfig` implementation delegating to unified logic |
| `src/config/unifiedControl.ts` (new)                                 | `tryParseUnifiedControlConfig(input: unknown): ControlConfig                                                                                                                                                                                                                                                                                                                                                  |
| `src/config/onesignalInitNormalize.ts` (new)                         | `normalizeNotificationPropertyForInit(property: Record<string, unknown>): Record<string, unknown>` — deep clone via JSON parse/stringify or hand-walk `promptOptions.slidedown.prompts[]` to coerce `delay` fields                                                                                                                                                                                            |
| `src/hub/ControlService.ts`                                          | Still calls `tryParseControlConfig(json)` — no signature change                                                                                                                                                                                                                                                                                                                                               |
| `src/hub/Hub.ts`                                                     | `setToggles` default `version` string; **notification branch** in `setControlConfig` subsequent updates: when `notification` enabled and any notification config field differs from previous, `await plugin.init(ctx, nextNotification)` then `onToggle(false)` then `onToggle(true)` (mirror gamification pattern)                                                                                           |
| `src/plugins/onesignal/OneSignalPlugin.ts`                           | Widen `OneSignalLike.init` args; `parseOneSignalConfig` reads extended fields; `enable()` builds `OneSignal.init({ ...normalizeNotificationPropertyForInit(merged), appId })`                                                                                                                                                                                                                                 |
| `src/plugins/gamification/GamificationPlugin.ts`                     | No structural change if `init` still receives `GamificationIntegrationToggleConfig`-shaped object; ensure `parseGamificationConfig` still reads `apiKey` if present in config for future static-key path                                                                                                                                                                                                      |
| `test/parseControlConfig.test.ts`                                    | Rename conceptually to unified parser tests; replace all legacy `integrations` fixtures with `modules` payloads                                                                                                                                                                                                                                                                                               |
| `test/ControlService.test.ts`                                        | All mock JSON bodies and `ControlConfig` literals: `version` string, unified shape                                                                                                                                                                                                                                                                                                                            |
| `test/hub-plugin-registry.test.ts`                                   | Same                                                                                                                                                                                                                                                                                                                                                                                                          |
| `test/control-config-wiring.test.ts`                                 | Same if it embeds config                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/superpowers/specs/2026-04-09-unified-control-config-design.md` | Reference only (already approved)                                                                                                                                                                                                                                                                                                                                                                             |


---

## Root JSON contract (implementation)

`tryParseControlConfig` returns `undefined` when:

- Input is not a plain object (`isPlainObject` same semantics as current `tryParseControlConfig`).
- `version` is missing, or is neither a non-empty string (after trim) nor a finite number (coerce number → `String(n)`).
- `modules` is missing or is not an array.

`tryParseControlConfig` returns a **defined** `ControlConfig` when the root is valid, including when `modules` is `[]` (both integrations off, `version` + empty integrations defaults).

`**sdkId`:** optional; if present and `typeof === "string"` after trim non-empty, set `ControlConfig.sdkId`; otherwise omit field.

---

### Task 1: Types and equality (`schema.ts`)

- [x] **Done** — `ControlConfig.version` is `string`, optional `sdkId`; `NotificationIntegrationToggleConfig` extended with OneSignal init options; `areControlConfigsEqual` / exported `areNotificationIntegrationConfigsEqual` compare gamification fields and notification extras including `promptOptions` after `normalizeNotificationPropertyForInit` delay coercion; lenient `parseControlConfig` removed in favor of unified-only strict parse.

**Files:**

- Modify: `src/config/schema.ts`
- **Step 1:** Change `ControlConfig` to:

```ts
export interface ControlConfig {
  version: string;
  sdkId?: string;
  integrations: IntegrationToggleConfigByKey;
}
```

- **Step 2:** Extend `NotificationIntegrationToggleConfig` with optional fields aligned to OneSignal Web v16 `init` (all optional): `autoResubscribe`, `serviceWorkerEnabled`, `serviceWorkerPath`, `serviceWorkerParam`, `notificationClickHandlerMatch`, `notificationClickHandlerAction`, `persistNotification`, `promptOptions` (type `unknown` or a minimal recursive interface — prefer `unknown` + runtime normalization in `onesignalInitNormalize.ts` to avoid fighting OneSignal’s types).
- **Step 3:** Update `areControlConfigsEqual` to compare `a.sdkId === b.sdkId`, `a.version === b.version`, and for each integration the same fields as today **plus** shallow/deep equality for notification extras. Practical approach: **stable JSON stringify** of `integrations.notification` and `integrations.gamification` after normalizing key order is fragile; prefer explicit field-by-field for notification (list every `NotificationIntegrationToggleConfig` key) and existing gamification fields. For `promptOptions`, use `JSON.stringify` on normalized objects **after** delay coercion so string comparison matches runtime behavior.
- **Step 4:** Run `npm run lint` — expect errors until parser is updated (commit after Task 2–3 fixes callers).

---

### Task 2: Delay coercion (`onesignalInitNormalize.ts`)

- [x] **Done** — `src/config/onesignalInitNormalize.ts` exports `coerceNumericDelayValue` and `normalizeNotificationPropertyForInit`; covered by `test/onesignalInitNormalize.test.ts` (and unified notification tests in `parseControlConfig.test.ts`).

**Files:**

- Create: `src/config/onesignalInitNormalize.ts`
- Test: add cases inside `test/parseControlConfig.test.ts` or `test/onesignalInitNormalize.test.ts`
- **Step 1: Write failing tests** for `coerceNumericDelayValue`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeNotificationPropertyForInit } from "../src/config/onesignalInitNormalize";

describe("normalizeNotificationPropertyForInit", () => {
  it("coerces delay.pageViews and delay.timeDelay from strings to numbers", () => {
    const input = {
      appId: "x",
      promptOptions: {
        slidedown: {
          prompts: [
            {
              delay: { pageViews: "1", timeDelay: "5" },
            },
          ],
        },
      },
    };
    const out = normalizeNotificationPropertyForInit(input as Record<string, unknown>);
    const prompts = (out.promptOptions as any).slidedown.prompts;
    expect(prompts[0].delay.pageViews).toBe(1);
    expect(prompts[0].delay.timeDelay).toBe(5);
  });

  it("omits delay keys when coercion fails", () => {
    const input = {
      promptOptions: {
        slidedown: {
          prompts: [{ delay: { pageViews: "nope", timeDelay: 3 } }],
        },
      },
    };
    const out = normalizeNotificationPropertyForInit(input as Record<string, unknown>);
    const delay = (out.promptOptions as any).slidedown.prompts[0].delay;
    expect("pageViews" in delay).toBe(false);
    expect(delay.timeDelay).toBe(3);
  });
});
```

- **Step 2:** Run `npm run test -- --run test/onesignalInitNormalize.test.ts` — FAIL (module missing).
- **Step 3:** Implement `coerceNumericDelayValue(value: unknown): number | undefined` (finite number pass-through; string trimmed → `Number()` → finite check).
- **Step 4:** Implement `normalizeNotificationPropertyForInit` that clones `property` (structured clone or `JSON.parse(JSON.stringify())` with try/catch fallback to shallow copy), walks `promptOptions?.slidedown?.prompts` if array, fixes `delay` object per field.
- **Step 5:** Run tests — PASS.
- **Step 6:** Commit: `git add src/config/onesignalInitNormalize.ts test/onesignalInitNormalize.test.ts && git commit -m "feat: normalize OneSignal delay fields for init"`

---

### Task 3: Unified parser (`unifiedControl.ts`)

- [x] **Done** (2026-04-09) — `src/config/unifiedControl.ts` + `src/config/controlParseHelpers.ts` (shared `isPlainObject` / gamification sanitizers); `tryParseControlConfig` delegates to `tryParseUnifiedControlConfig`; legacy `parseControlConfig` removed.

**Files:**

- Create: `src/config/unifiedControl.ts`
- Modify: `src/config/schema.ts` (re-export or inline call)
- **Step 1:** Move private helpers `safeTokenBaseUrl`, `safePackageVersion`, `isPlainObject`, `safeNonEmptyString` from `schema.ts` into `unifiedControl.ts` **or** export them from `schema.ts` as named exports used only by unified parser — avoid duplication; **single source of truth**.
- **Step 2:** Implement `extractFirstModule(modules: unknown[], type: "NOTIFICATION" | "GAMIFICATION")`: return first element where `module.type === type` and `isPlainObject(module)`.
- **Step 3:** Implement `resolveModuleProperty(module: Record<string, unknown>): Record<string, unknown> | undefined` — if `property` key missing → `{}`; if present and `isPlainObject(property)` → return as `Record<string, unknown>`; else → `undefined` (caller treats integration as **disabled**).
- **Step 4:** Build `notification` integration: if `resolveModuleProperty` returned `undefined` → `{ enabled: false }`. Else `enabled: true` and merge: parse `appId` with `safeNonEmptyString`, copy boolean/string fields from `normalizeNotificationPropertyForInit(property)` into `NotificationIntegrationToggleConfig` (only assign keys that are valid on the type; use `normalizeNotificationPropertyForInit` output as the source for `promptOptions` subtree).
- **Step 5:** Build `gamification` integration: same enabled/property rules; run existing gamification sanitizers (`safePackageVersion`, `safeTokenBaseUrl`, `safeNonEmptyString` for `apiKey`/`clientKey`).
- **Step 6:** Implement `tryParseUnifiedControlConfig(input: unknown): ControlConfig | undefined` assembling `{ version, sdkId?, integrations }`.
- **Step 7:** In `schema.ts`, set `export function tryParseControlConfig(input: unknown): ControlConfig | undefined { return tryParseUnifiedControlConfig(input); }` and delete old body.
- **Step 8:** Remove `parseControlConfig` **or** replace implementation with a **dev/test-only** helper that wraps unified payloads — simplest: **delete** `parseControlConfig` and update tests to use `tryParseControlConfig` only (or raw object literals for `ControlConfig` where parser is not under test).
- **Step 9:** Run `npm run lint` and fix.
- **Step 10:** Commit: `feat: parse unified modules control JSON`

---

### Task 4: Parser unit tests (`parseControlConfig.test.ts`)

- [x] **Done** (2026-04-09) — `test/parseControlConfig.test.ts` covers unified wire, strict root failure, first-module wins, invalid NOTIFICATION `property`, gamification sanitization, delay coercion; `test/ControlService.test.ts` / wiring tests aligned to `version` + `modules` bodies.

**Files:**

- Modify: `test/parseControlConfig.test.ts`
- **Step 1:** Replace `expectedDefaults` with unified failure behavior: `tryParseControlConfig(null)` → `undefined` **if** strict root only — align with design: invalid root → `undefined`. **Note:** old tests expected `parseControlConfig` to return defaults for garbage input; **new** `tryParseControlConfig` matches spec for **HTTP** (undefined on bad root). Add tests:
  - Valid minimal: `{ version: "1", modules: [] }` → `{ version: "1", integrations: { notification: { enabled: false }, gamification: { enabled: false } } }` (no `sdkId`).
  - `version` numeric `1` → `"1"`.
  - First NOTIFICATION wins, second ignored.
  - Invalid `property` on NOTIFICATION only → notification off, gamification still on if valid.
  - Gamification token fields sanitized.
- **Step 2:** Remove all tests that only applied to lenient `parseControlConfig` unless reimplemented as `tryParse` expectations.
- **Step 3:** Run `npm run test` — fix until green.
- **Step 4:** Commit: `test: unified control config parser`

---

### Task 5: OneSignal plugin

- [x] Complete (2026-04-09)

**Files:**

- Modify: `src/plugins/onesignal/OneSignalPlugin.ts`
- **Step 1:** Update `parseOneSignalConfig` to accept `Record<string, unknown>` and build init options: start from `normalizeNotificationPropertyForInit(config as Record<string, unknown>)`, ensure `appId` from `safeNonEmptyString` on raw config wins.
- **Step 2:** In `enable()`, call `OneSignal.init` with `{ ...parsed, appId }` where `appId` is required string — if missing, return early (same as today).
- **Step 3:** Add unit test in `test/` (existing OneSignal test file if any, or new) asserting `init` called with numeric delays — mock `OneSignalDeferred`.
- **Step 4:** Run `npm run test` — PASS.
- **Step 5:** Commit: `feat(onesignal): pass unified init options with normalized delay`

---

### Task 6: Hub — version string + notification config refresh

- [x] Complete (2026-04-09)

**Files:**

- Modify: `src/hub/Hub.ts`
- **Step 1:** In `setToggles`, change `version: this.currentControlConfig?.version ?? 0` to `?? "0"` (string).
- **Step 2:** In `setControlConfig`, after the gamification block, add **notification** handling for `initialized === true`: when `prev` and `next` both have `integrations.notification.enabled === true`, compare `integrations.notification` using same semantics as `areControlConfigsEqual` for notification fields; if changed, `await plugin.init(ctx, next.integrations.notification)`, then `plugin.onToggle(false)`, then `plugin.onToggle(true)`.
- **Step 3:** When `prevEnabled !== nextEnabled` for notification, keep existing `onToggle` only (no double init).
- **Step 4:** Add test in `test/hub-plugin-registry.test.ts`: two configs, same enabled true, different `appId` or `promptOptions`, expect `init` called twice on notification plugin mock.
- **Step 5:** Run `npm run test` — PASS.
- **Step 6:** Commit: `feat(hub): string control version and re-init notification on config change`

---

### Task 7: ControlService and integration tests

- [x] Complete (2026-04-09)

**Files:**

- Modify: `test/ControlService.test.ts`, `test/control-config-wiring.test.ts`
- **Step 1:** Update every `ControlConfig` literal: `version: "1"` (string), `integrations` unchanged in **shape** but tests that build **fake fetch responses** must return **unified JSON** (`version`, `modules`) not `integrations`.
- **Step 2:** For ETag / `onUpdate` tests, ensure bodies that were “invalid” under old strict parser are reclassified per new rules (invalid root vs partial module).
- **Step 3:** Run `npm run test` — PASS.
- **Step 4:** Commit: `test: align ControlService with unified control wire format`

---

### Task 8: Final verification and docs touch-up

- [x] Complete (2026-04-09)

- **Step 1:** Run `npm run lint` and `npm run test` — all green.
- **Step 2:** Run `npm run build` — ensure `dist` types include `ControlConfig` if exported from barrel; if `ControlConfig` is internal-only, no change to `src/index.ts`.
- **Step 3:** Add one line to `2026-04-09-unified-control-config-design.md` under Testing: “Implemented in `test/parseControlConfig.test.ts`, `test/ControlService.test.ts`, …” (optional).
- **Step 4:** Commit: `chore: verify build after unified control config`

---

## Spec coverage (self-review)


| Design requirement                              | Task      |
| ----------------------------------------------- | --------- |
| Unification-only wire, no `integrations` legacy | Task 3, 4 |
| `version` string                                | Task 1, 3 |
| `sdkId` optional                                | Task 3    |
| First module wins                               | Task 3    |
| Invalid `property` disables module only         | Task 3, 4 |
| `delay` string/number in → number in `init`     | Task 2, 5 |
| Gamification validation preserved               | Task 3    |
| Partial success vs invalid root                 | Task 3, 7 |
| ETag equality includes new fields               | Task 1    |


**Placeholder scan:** No TBD steps; file paths are explicit.

**Type consistency:** `ControlConfig.version` is `string` everywhere after Task 1; Hub `setToggles` uses `"0"` default.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-09-unified-control-config.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you want?