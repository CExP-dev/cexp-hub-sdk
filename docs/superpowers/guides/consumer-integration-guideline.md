# CExP Hub SDK: Consumer Integration Guideline

Audience: application teams integrating `cexp-hub-sdk` into websites or SPAs.

## What You Integrate

Use only the `CExP` public API:

- `CExP.init({ id })`
- `CExP.track(event, props?)`
- `CExP.identify(userId, traits?)`
- `CExP.page(pageProps?)`
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
CExP.track("page_loaded", { section: "home" });
```

### Option B: Browser script (global)

```html
<script src="https://cdn.jsdelivr.net/npm/cexp-hub-sdk@<version>/dist/browser.global.js"></script>
<script>
  window.CExP.init({ id: "your-sdk-id" });
  window.CExP.track("page_loaded", { section: "home" });
</script>
```

Pin a specific package version for predictable behavior in production.

## Evergreen vs Vendor Updates

### What is evergreen

Evergreen means consumers never change the SDK script (host/path or URL) after integration. Once your application is deployed, you should not update the script tag or CDN path to pick up backend changes.

### What changes with vendor updates

When vendors update, the hub can safely change backend control configuration “knobs” that preserve integration compatibility (for example, gamification `packageVersion`).

If the hub needs to change the pinned script host/path itself, that requires a new hub release. In that case, consumers still keep their integration code unchanged, but you must pull the updated hub release that provides the new script URL.

## Integration Rules

1. Call `CExP.init({ id })` once, as early as possible.
2. Do not call `track`, `page`, `identify`, or `reset` before `init`.
3. Keep event names stable and lowercase snake_case (recommended convention).
4. Pass plain JSON-like objects for event props and traits.
5. Treat the SDK as the only analytics/push/gamification entry point in your app.

## API Behavior Details

### `CExP.init({ id })`

- Required before any other API call.
- Initializes hub runtime and fetches remote control config by `id`.
- Starts background polling for config updates.

```ts
CExP.init({ id: "sdk_abc123" });
```

### `CExP.track(event, props?)`

- Sends a named business event.
- If called with non-string event value, SDK normalizes to `"unknown_event"`.
- When called immediately after `init`, events are buffered briefly until first config resolves.

```ts
CExP.track("cta_clicked", {
  location: "hero",
  campaign: "spring_sale",
});
```

### `CExP.identify(userId, traits?)`

- Associates future events with a known user profile.
- Ignored if `userId` is empty/non-string.
- Can be called more than once (for trait updates or user transitions).

```ts
CExP.identify("user-123", {
  email: "user@example.com",
  plan: "pro",
});
```

### `CExP.page(pageProps?)`

- Sends an explicit page-view style payload through the hub (routed to **gamification** when that integration is enabled).
- Use this from SPA router hooks if you need per-route signals; the SDK does **not** subscribe to `history` automatically.

```ts
CExP.page({
  name: "pricing",
  path: "/pricing",
});
```

### `CExP.reset()`

- Clears runtime state for the current session lifecycle.
- Stops runtime services.
- After `reset`, you must call `init({ id })` again before sending events.

```ts
CExP.reset();
```

## SPA Guidance

For SPAs, integrate at the application root:

- Call `CExP.init()` once during app bootstrap.
- Optionally call `CExP.page()` on route-change hooks for business-friendly names.
- Avoid calling `init()` on every route transition.

Example:

```ts
router.afterEach((to) => {
  CExP.page({ name: String(to.name ?? "unknown"), path: to.fullPath });
});
```

## Recommended Event Taxonomy

Use consistent, domain-level event names:

- `signup_started`
- `signup_completed`
- `checkout_started`
- `checkout_completed`
- `feature_used`

Keep payloads small and purposeful:

- Good: identifiers, product context, plan, source, state.
- Avoid: large blobs, raw HTML, PII you do not need.

## Error Handling Pattern

The SDK can throw if APIs are used before `init`. Wrap calls in app-safe utilities when needed.

```ts
export function safeTrack(event: string, props?: Record<string, unknown>) {
  try {
    CExP.track(event, props);
  } catch (error) {
    // Optional: route to your app logger
    console.warn("[analytics] track failed", error);
  }
}
```

## Environment Checklist

- Use a production SDK id in production and a separate id for staging/dev.
- Ensure CSP allows the SDK script source (and vendor sources enabled by your backend config).
- Pin SDK version when using CDN.
- Validate a smoke path: init -> track -> identify -> page.

## Validation Checklist (Before Release)

- [ ] `init({ id })` is called once on app start.
- [ ] No direct use of `OneSignal` or `cexp` globals outside the documented `CExP` API.
- [ ] Core events fire on key product journeys.
- [ ] User identify flow is triggered after login.
- [ ] `page()` is wired for SPA route transitions (if needed).
- [ ] No pre-init API calls in startup race paths.

## Troubleshooting

- **Error: cannot call before init**  
  Ensure `CExP.init({ id })` runs before any telemetry calls.

- **Events not visible downstream**  
  Confirm valid `id`, environment config, and that required integrations are enabled in backend control config.

- **Duplicate page events**  
  If your app emits manual route events aggressively, review `page()` calls and de-duplicate in router hooks.

- **Noisy/low-quality event data**  
  Standardize naming + payload schema and remove unstable properties.

