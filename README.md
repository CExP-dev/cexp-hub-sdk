# CExP Hub SDK

Browser SDK facade exposed as `window.CExP` (IIFE) or `CExP` (ESM import).

## Public API

Only the following APIs are supported for consumer code:

- `CExP.init({ id })`
- `CExP.track(event, props?)`
- `CExP.identify(userId, traits?)`
- `CExP.reset()`
- `CExP.page(pageProps?)`

### `CExP.init({ id })`

Initialize once with your SDK id before any other call.
`track` / `page` / `identify` / `reset` must be called only after `init({ id })`; otherwise they throw.

```ts
CExP.init({ id: "your-sdk-id" });
```

### `CExP.track(event, props?)`

Track an event by name.

```ts
CExP.track("button_clicked", { location: "hero" });
```

### `CExP.identify(userId, traits?)`

Associate future events with a user id and optional traits.

```ts
CExP.identify("user-123", { plan: "pro" });
```

### `CExP.reset()`

Tear down SDK runtime state for the current page. Call `init({ id })` again before sending events (`track` / `page` / `identify`).

```ts
CExP.reset();
```

### `CExP.page(pageProps?)`

Emit an explicit page-view style event payload.

```ts
CExP.page({ name: "pricing" });
```

## Consumer Code Guardrail

Do not use vendor globals in app code (use `CExP` only):

- `window.OneSignal` / OneSignal deferred queues
- `window.cexp` (gamification)

Integrations and plugin internals are SDK-managed and may change independently.

## Evergreen vs Vendor Updates

### What is evergreen

Evergreen means consumers never change the SDK script (host/path or URL) after integration. Your integration code stays stable while the hub updates runtime behavior.

### What changes with vendor updates

With vendor updates, the hub can update safe integration “knobs” via backend control configuration (for example, gamification `packageVersion`).

If the hub needs to change the pinned script host/path itself, that requires a new hub release (consumers should update by pulling the new hub release, not by editing their app’s integration code).

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

