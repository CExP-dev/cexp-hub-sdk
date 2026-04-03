# CExP Hub SDK

Browser SDK facade exposed as `window.CExP` (IIFE) or `CExP` (ESM import).

The hub loads **remote control config** for your `sdkId` (toggles + optional integration fields), polls for updates, and routes calls to internal integrations. **Two integrations** are supported: **OneSignal** (push / user association) and **gamification** (`cexp-gamification`). Consumers use only `CExP`; they do not configure vendors directly.

More detail: [`docs/superpowers/architecture/2026-03-20-cexp-hub-sdk-system-architecture.md`](docs/superpowers/architecture/2026-03-20-cexp-hub-sdk-system-architecture.md).

## Public API

Supported surface for application code:

- `CExP.init({ id })`
- `CExP.track(event, props?)`
- `CExP.page(pageProps?)`
- `CExP.identify(userId, traits?)`
- `CExP.reset()`
- `CExP.version` — hub package version (from `package.json` for that build)

### Routing (high level)

| Call | When integrations are enabled in control config |
| --- | --- |
| `track` | Forwarded to **gamification** only. |
| `page` | Forwarded to **gamification** only (explicit calls; there is no automatic `history` listener). |
| `identify` | Forwarded to **OneSignal** and **gamification** (each if its toggle is on). |
| `reset` | Forwarded to **OneSignal** and **gamification** (each if its toggle is on). |

If a toggle is off, the corresponding integration is not loaded and those calls are effectively no-ops for that vendor.

### `CExP.init({ id })`

Initialize once with your SDK id before any other call.
`track` / `page` / `identify` / `reset` must be called only after `init({ id })`; otherwise they throw.

```ts
CExP.init({ id: "your-sdk-id" });
```

### `CExP.track(event, props?)`

Track a named event. Routed to gamification when that integration is enabled.

```ts
CExP.track("button_clicked", { location: "hero" });
```

### `CExP.page(pageProps?)`

Emit an explicit page-style payload (e.g. from your SPA router). Routed to gamification when enabled. Not tied to browser history automatically.

```ts
CExP.page({ name: "pricing", path: "/pricing" });
```

### `CExP.identify(userId, traits?)`

Associate the current user (and optional traits) with downstream integrations. Routed to OneSignal and/or gamification per toggles.

```ts
CExP.identify("user-123", { plan: "pro" });
```

### `CExP.reset()`

Tear down SDK runtime state for the current page. Call `init({ id })` again before sending events.

```ts
CExP.reset();
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

### What needs a new hub release

Changes to **hub-pinned** script URLs, init behavior, or public `CExP` API require a new **`cexp-hub-sdk`** version (npm / CDN).

## Build

- Install deps: `npm install`
- Build: `npm run build`
- Typecheck: `npm run lint`
- Tests: `npm run test`

## npm / jsDelivr version paths

- npm package: [`cexp-hub-sdk`](https://www.npmjs.com/package/cexp-hub-sdk)
- Pin a published version on jsDelivr:
  - `https://cdn.jsdelivr.net/npm/cexp-hub-sdk@<version>/dist/browser.global.js`
- ESM entry in package exports:
  - `cexp-hub-sdk` (maps to `dist/index.js`)
