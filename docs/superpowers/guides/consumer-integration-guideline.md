# CExP Hub SDK: Consumer Integration Guideline

Audience: application teams integrating `cexp-hub-sdk` into websites or SPAs.

## What You Integrate

Use only the `CExP` public API:

- `CExP.init({ id })`
- `CExP.identify(userId, traits?)`
- `CExP.reset()`

Do not call internal/vendor globals directly from app code:

- `window.OneSignal` / OneSignal deferred queues
- `window.cexp` (gamification)

These are managed internally by the SDK and may change without notice.

## Quick Start

### Option A: ESM (recommended for modern apps)

```ts
import { CExP } from "cexp-hub-sdk";

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

## Evergreen vs Vendor Updates

### What is evergreen

Evergreen means consumers never change the SDK script (host/path or URL) after integration. Once your application is deployed, you should not update the script tag or CDN path to pick up backend changes.

### What changes with vendor updates

When vendors update, the hub can safely change backend control configuration "knobs" that preserve integration compatibility (for example, gamification `packageVersion`).

If the hub needs to change the pinned script host/path itself, that requires a new hub release. In that case, consumers still keep their integration code unchanged, but you must pull the updated hub release that provides the new script URL.

## Integration Rules

1. Call `CExP.init({ id })` once, as early as possible.
2. Do not call `identify` or `reset` before `init`.
3. Pass plain JSON-like objects for traits.
4. Treat the SDK as the only push/gamification entry point in your app.

## API Behavior Details

### `CExP.init({ id })`

- Required before any other API call.
- Initializes hub runtime and fetches remote control config by `id`.
- Starts background polling for config updates.

```ts
CExP.init({ id: "sdk_abc123" });
```

### `CExP.identify(userId, traits?)`

- Associates the session with a known user profile.
- Forwarded to enabled integrations (notification + gamification).
- Ignored if `userId` is empty/non-string.
- Can be called more than once (for trait updates or user transitions).

```ts
CExP.identify("user-123", {
  email: "user@example.com",
  plan: "pro",
});
```

### `CExP.reset()`

- Clears runtime state for the current session lifecycle (logs out from notification integration).
- Stops runtime services.
- After `reset`, you must call `init({ id })` again before using the SDK.

```ts
CExP.reset();
```

## Integration Rules

1. Call `CExP.init({ id })` once, as early as possible.
2. Do not call `identify` or `reset` before `init`.
3. Pass plain JSON-like objects for traits.
4. Treat the SDK as the only push/gamification entry point in your app.

## Error Handling Pattern

The SDK can throw if APIs are used before `init`. Wrap calls in app-safe utilities when needed.

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
- Validate a smoke path: init -> identify -> reset.

## Validation Checklist (Before Release)

- [ ] `init({ id })` is called once on app start.
- [ ] No direct use of `OneSignal` or `cexp` globals outside the documented `CExP` API.
- [ ] User identify flow is triggered after login.
- [ ] No pre-init API calls in startup race paths.

## Troubleshooting

- **Error: cannot call before init**  
  Ensure `CExP.init({ id })` runs before any other SDK calls.

- **Events not visible downstream**  
  Confirm valid `id`, environment config, and that required integrations are enabled in backend control config.

- **Noisy/low-quality data**  
  Standardize naming + payload schema and remove unstable properties.
