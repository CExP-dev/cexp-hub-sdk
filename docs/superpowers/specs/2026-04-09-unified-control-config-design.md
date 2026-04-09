# Unified control config (breaking) — design

## Context

The control endpoint JSON moves from `{ version, integrations }` to the shape in [`CExP-SDK-Unification Schema.md`](./CExP-SDK-Unification%20Schema.md): top-level `version` (string), `sdkId`, and `modules[]` entries with `id`, `type`, and `property`.

The SDK will use a **unification-only parser (breaking)** — responses in the legacy `integrations` shape are no longer accepted.

## Wire format (authoritative)

- **`version`:** string (per unification doc). The SDK may accept a numeric JSON value only if we explicitly coerce it to string for internal use; primary contract is string.
- **`sdkId`:** optional string at top level; stored if present for hub/diagnostics.
- **`modules`:** array of objects. Each object has:
  - **`id`:** string (opaque to SDK; no behavior required).
  - **`type`:** `"NOTIFICATION"` | `"GAMIFICATION"` (case-sensitive unless we document otherwise; default: **exact match** as in the spec).
  - **`property`:** object with integration-specific keys (see unification doc). Unknown keys in `property` may be ignored or passed through per integration rules.

Unknown `type` values are ignored. Extra top-level keys are ignored.

## Enabled semantics

- **`NOTIFICATION` is on** iff the `modules` array contains at least one entry with `type === "NOTIFICATION"` **and** that entry’s `property` is valid (see below).
- **`GAMIFICATION` is on** under the same rule for `type === "GAMIFICATION"`.

If a type is **absent** from `modules`, that integration is **off**.

**Valid `property`:** a **plain object** (JSON object, not `null`, not array). If `property` is **omitted**, treat it as **`{}`** (empty object) — the module is still **on** (subject to integration-specific requirements such as OneSignal requiring `appId` before load).

**Invalid `property`:** if `property` is present but is **not** a plain object (e.g. string, number, array, `null`), that **single module is treated as off** — **do not** fail the entire payload (**Policy B**).

## Policy decisions

| Topic | Decision |
|--------|-----------|
| **A — Duplicate modules** | **First wins:** for each of `NOTIFICATION` and `GAMIFICATION`, use the **first** matching module in `modules` array order. Later duplicates are ignored. |
| **B — Invalid `property`** | **Disable that module only;** parse the rest of the payload. Other integrations may still apply. |

## Internal representation

After parsing, the SDK holds an **in-memory** config (not the raw JSON). It should expose the same **concepts** the hub and plugins already need:

- Per-integration **enabled** flags (derived from rules above).
- **`notification` config:** fields from the winning `NOTIFICATION.property`, including extended OneSignal `init` options (`autoResubscribe`, `serviceWorker*`, `notificationClickHandler*`, `persistNotification`, `promptOptions`, etc.) plus **`appId`**.
- **`gamification` config:** `packageVersion`, `clientKey`, `tokenBaseUrl`, and optionally `apiKey` if still used by the plugin, from the winning `GAMIFICATION.property`.
- **`version`:** string (normalized from wire).
- **`sdkId`:** optional string from top level when present.

Equality for ETag / `onUpdate` should compare this normalized structure (including notification and gamification subtrees).

## OneSignal (`NOTIFICATION`)

- Load behavior stays aligned with OneSignal Web v16 deferred init.
- **`OneSignal.init`** receives **`appId`** (required before load, same as today) **plus** any supported options parsed from `property`.
- **`delay.pageViews`** and **`delay.timeDelay`:** accept **number or string** in JSON so hosts can match OneSignal examples (numbers) while the markdown spec shows strings.

## Gamification (`GAMIFICATION`)

- Map `property` fields per unification doc. Preserve existing validation for `tokenBaseUrl`, `packageVersion`, etc., consistent with current `schema.ts` rules where applicable.

## Parsing strictness vs `ControlService`

- **`ControlService`** today uses strict parsing that rejects invalid payloads entirely. Under this design, **partial success** is allowed: invalid `property` on one module disables **that** integration only; the overall payload still updates if top-level `version` and `modules` array are structurally acceptable.
- Exact rules for “structurally acceptable” root payload should be defined in implementation (e.g. `version` must be present and a string, `modules` must be an array). If the root is invalid, keep last-known-good config and do not call `onUpdate` (same spirit as today).

## Testing

- Fixtures for: both modules, single module, neither module, duplicate types (**first wins**), invalid `property` on one side only, `delay` as number vs string, missing `property` on a module (treated as `{}`).

## Out of scope (this design)

- Legacy `{ integrations }` compatibility (explicitly **out** — breaking change).
- Backend implementation of the new JSON.

---

## Self-review checklist

1. **Placeholders:** None; policies and behaviors are specified.
2. **Consistency:** Enabled + invalid `property` interact as: invalid property ⇒ that type off; missing property ⇒ `{}` ⇒ on unless integration-specific gates (e.g. no `appId`) prevent load.
3. **Scope:** Single SDK parser + hub/plugin wiring; no backend spec beyond referencing the unification doc.
4. **Ambiguity:** `type` matching: **exact** `"NOTIFICATION"` / `"GAMIFICATION"` unless product standardizes otherwise — document in implementation if case-insensitive.
