# CExP Hub SDK

Browser SDK facade exposed as `window.CExP` (IIFE) or via ESM/CJS import from `cexp-hub-sdk`.

The hub loads **remote control config** for your `sdkId` (toggles + optional integration fields), polls for updates, and routes calls to internal integrations. **Two integrations** are supported: **OneSignal** (push / user association) and **gamification** (`cexp-gamification`). Consumers use only `CExP`; they do not configure vendors directly.

More detail: [`docs/superpowers/architecture/2026-03-20-cexp-hub-sdk-system-architecture.md`](docs/superpowers/architecture/2026-03-20-cexp-hub-sdk-system-architecture.md).

## Public API

Supported surface for application code:

- `CExP.init({ id })`
- `CExP.version` — hub package version (from `package.json` for that build)
- **Fan-out (backwards-compatible):** `CExP.identify(userId, traits?)`, `CExP.reset()`
- **Integration namespaces (preferred when you target one integration):**
  - `CExP.notification.identify(userId)`, `CExP.notification.reset()`
  - `CExP.gamification.identify(userId, traits?)`, `CExP.gamification.reset()`

ESM/CJS also re-export `init`, `identify`, `reset`, `version`, `notification`, and `gamification` from the package root for named imports.

### Routing (high level)

| Call | When integrations are enabled in control config |
| --- | --- |
| Top-level `identify` | Forwarded to **OneSignal** and **gamification** (each if its toggle is on). After `init`, if the first config fetch has not finished yet, calls are **queued** and flushed in order once config is applied. |
| `notification.identify` / `notification.reset` | **OneSignal** only. No-ops until the first config response has been applied (then respects the notification toggle). |
| `gamification.identify` / `gamification.reset` | **Gamification** only. Same “after first config” behavior as `notification.*`. |
| Top-level `reset` | Stops polling, clears hub runtime, and resets integration state as part of teardown. Call `init({ id })` again before further use. |

If a toggle is off, the corresponding integration is not loaded and those calls are effectively no-ops for that vendor.

### `CExP.init({ id })`

Initialize once with your SDK id before any other call.

`identify`, `reset`, and namespace methods must be called only after `init({ id })`; otherwise they throw (namespace methods that run before the first config is applied return without throwing).

```ts
CExP.init({ id: "your-sdk-id" });
```

### `CExP.identify(userId, traits?)`

Associate the current user (and optional traits) with downstream integrations. Routed to OneSignal and/or gamification per toggles. Ignored if `userId` is empty or not a string.

```ts
CExP.identify("user-123", { plan: "pro" });
```

### `CExP.reset()`

Tear down SDK runtime state for the current page. Call `init({ id })` again before sending events.

```ts
CExP.reset();
```

### Namespaces: `notification` and `gamification`

Use these when you want to update or reset **one** integration without relying on top-level fan-out.

```ts
CExP.notification.identify("user-123");
CExP.gamification.identify("user-123", { plan: "pro" });

CExP.notification.reset(); // OneSignal logout when enabled
CExP.gamification.reset(); // no-op unless gamification implements reset
```

## Consumer code guardrail

Do not use vendor globals from application code — use `CExP` only:

- OneSignal deferred queues / `OneSignal` globals managed by the SDK
- `window.cexp` (gamification)

Integration wiring and script URLs are SDK-managed and may change with hub releases or backend config.

## Evergreen vs vendor updates

### Evergreen

Consumers keep a stable script URL (or pinned major) after integration; behavior can evolve via **backend control config** and hub releases without rewriting app calls to `CExP`.

### What can change without a new snippet

Safe, validated fields in control JSON (e.g. gamification `packageVersion` / `apiKey` when your platform exposes them) can be updated server-side for a given `sdkId`.

For **gamification**, control JSON may supply **`clientKey`** and **`tokenBaseUrl`**: the hub fetches a short-lived JWT from `GET {tokenBaseUrl}/sv/token` before loading the vendor script and passes that token into the SDK. If those CDP fields are not both set, the hub uses the static **`apiKey`** from control JSON instead (no token HTTP call). Environment-specific **`tokenBaseUrl`** values are set per deployment on the backend.

### What needs a new hub release

Changes to **hub-pinned** script URLs, init behavior, or public `CExP` API require a new **`cexp-hub-sdk`** version (npm / CDN).

## Build

- Install deps: `npm install`
- Build: `npm run build`
- Typecheck: `npm run lint`
- Tests: `npm run test`

## npm / jsDelivr version paths

- npm package: [`cexp-hub-sdk`](https://www.npmjs.com/package/cexp-hub-sdk)
- Pin a published version on jsDelivr (IIFE / `window.CExP`):
  - `https://cdn.jsdelivr.net/npm/cexp-hub-sdk@<version>/dist/browser.global.js`
- Package exports:
  - `"cexp-hub-sdk"` → ESM `dist/index.js`, CJS `dist/index.cjs`, types `dist/index.d.ts`
  - `"cexp-hub-sdk/browser"` and `"cexp-hub-sdk/iife"` → same browser bundle as above
