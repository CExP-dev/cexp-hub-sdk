# CExP Hub SDK: Consumer Integration Guideline

Audience: application teams integrating `cexp-hub-sdk` into websites or SPAs.

## What You Integrate

Use only the `CExP` public API:

- `CExP.init({ id })`
- `CExP.version`
- **Fan-out (convenience):** `CExP.identify(userId, traits?)`, `CExP.reset()`
- **Per-integration (preferred when you only touch one integration):**
  - `CExP.notification.identify(userId)`, `CExP.notification.reset()`
  - `CExP.gamification.identify(userId, traits?)`, `CExP.gamification.reset()`

Do not call internal/vendor globals directly from app code:

- `window.OneSignal` / OneSignal deferred queues
- `window.cexp` (gamification)

These are managed internally by the SDK and may change without notice.

## Quick Start

### Option A: ESM (recommended for modern apps)

```ts
import CExP from "cexp-hub-sdk";
// or: import { CExP } from "cexp-hub-sdk";

CExP.init({ id: "your-sdk-id" });
CExP.identify("user-123", { plan: "pro" });
```

### Option B: Browser script (global)

```html
<script src="https://cdn.jsdelivr.net/npm/cexp-hub-sdk@<version>/dist/browser.global.js"></script>
<script>
  window.CExP.init({ id: "your-sdk-id" });
  window.CExP.identify("user-123", { plan: "pro" });
</script>
```

Pin a specific package version for predictable behavior in production.

## Evergreen vs vendor updates

### What is evergreen

Evergreen means you keep a **stable** SDK script URL (host/path or pinned major) after integration. Backend control config and hub behavior can still evolve for your `sdkId` without you changing that URL for every tweak.

### What changes with vendor or backend updates

The hub can adjust **control configuration** (toggles, gamification `packageVersion`, keys, token URLs, and similar fields) without you editing app code, as long as those fields remain compatible.

If the hub must change **pinned script URLs** or the **public `CExP` API**, that requires a new **`cexp-hub-sdk`** release. You then upgrade the package or CDN version; your integration calls (`init`, `identify`, namespaces, etc.) stay the same unless the release notes say otherwise.

## Integration Rules

1. Call `CExP.init({ id })` once, as early as possible.
2. Do not call `identify`, `reset`, or namespace methods before `init` (they throw).
3. After `init`, **top-level** `identify` is **queued** until the first remote config fetch completes, then flushed in order.
4. **`notification.*` and `gamification.*`** do nothing until that first config is applied (they do not throw; they no-op until ready).
5. Pass plain JSON-like objects for traits where the API accepts them.
6. Treat the SDK as the only push/gamification entry point in your app.

## API Behavior Details

### `CExP.init({ id })`

- Required before any other API call.
- Initializes hub runtime and fetches remote control config by `id`.
- Starts background polling for config updates (after the first sync).

```ts
CExP.init({ id: "sdk_abc123" });
```

### `CExP.identify(userId, traits?)`

- Associates the session with a known user profile.
- Forwarded to enabled integrations (notification + gamification) according to toggles.
- Ignored if `userId` is empty or not a string.
- Can be called more than once (for trait updates or user transitions).
- If called after `init` but before the first config response is applied, calls are **queued** and then routed in order.

```ts
CExP.identify("user-123", {
  email: "user@example.com",
  plan: "pro",
});
```

### `CExP.notification` / `CExP.gamification`

- **identify:** targets only that integration; respects its toggle after config is ready.
- **reset:** `notification.reset` logs out / clears the OneSignal session without tearing down the whole hub. `gamification.reset` invokes the gamification plugin’s reset hook when that integration implements it (otherwise it is a no-op). Neither replaces top-level `CExP.reset()`, which stops the hub entirely.

```ts
CExP.notification.identify("user-123");
CExP.gamification.identify("user-123", { plan: "pro" });

CExP.notification.reset();
CExP.gamification.reset();
```

### `CExP.reset()`

- Tears down hub runtime for the current lifecycle (stops polling, clears state).
- After `reset`, you must call `init({ id })` again before using the SDK.

```ts
CExP.reset();
```

## Error Handling Pattern

The SDK throws if APIs are used before `init`. Wrap calls in app-safe utilities when needed.

```ts
export function safeIdentify(userId: string, traits?: Record<string, unknown>) {
  try {
    CExP.identify(userId, traits);
  } catch (error) {
    console.warn("[analytics] identify failed", error);
  }
}
```

## Environment Checklist

- Use a production SDK id in production and a separate id for staging/dev.
- Ensure CSP allows the SDK script source (and vendor sources enabled by your backend config).
- Pin SDK version when using CDN.
- Validate a smoke path: init → identify (or namespace identify) → reset as appropriate.

## Validation Checklist (Before Release)

- [ ] `init({ id })` is called once on app start.
- [ ] No direct use of `OneSignal` or `cexp` globals outside the documented `CExP` API.
- [ ] User identify flow is triggered after login (using top-level `identify` or the relevant namespace).
- [ ] No pre-init API calls in startup race paths.

## Troubleshooting

- **Error: cannot call before init**  
  Ensure `CExP.init({ id })` runs before any other SDK calls.

- **Identify seems to do nothing right after load**  
  For top-level `identify`, wait until after the first config fetch (or rely on queuing). For `notification.*` / `gamification.*`, remember they no-op until the first config is applied.

- **Noisy/low-quality data**  
  Standardize naming + payload schema and remove unstable properties.
