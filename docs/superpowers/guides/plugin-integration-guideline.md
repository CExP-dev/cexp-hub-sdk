# CExP Hub: New Plugin Integration Guideline

Audience: SDK developers extending `cexp-hub-sdk` with a new internal integration plugin.

## Big Picture: How The SDK Works

The browser SDK exposes a single public facade (`window.CExP`) and routes everything through the hub:

1. Consumer calls `CExP.init({ id })`.
2. `global.ts` creates `Hub`, `EventRouter`, and `ControlService`.
3. `ControlService` fetches remote config (by `sdkId`) and polls every 5 minutes.
4. Hub applies integration toggles and calls each plugin's `onToggle(enabled)` on changes.
5. `EventRouter` forwards `identify/reset` to enabled plugins per routing policy.
6. Each plugin owns vendor script lifecycle: load on enable, teardown + DOM/global cleanup on disable.

Reference files:
- `src/global.ts` (facade wiring, pre-config queue, startup flow)
- `src/hub/Hub.ts` (plugin registry, toggle transitions)
- `src/hub/EventRouter.ts` (event routing to enabled plugins)
- `src/hub/ControlService.ts` (remote control fetch + polling)
- `src/plugins/types.ts` (plugin contract)

## Plugin Contract You Must Implement

All plugins implement `Plugin` from `src/plugins/types.ts`:

- `name`: stable registry key (must match integration key used by hub).
- `init(ctx, config)`: one-time setup hook; store context/config references.
- `onToggle(enabled)`: lifecycle switch; this is where lazy-load + teardown happen.
- Optional hooks:
  - `identify(userId, traits?)`
  - `reset()`
  - `destroy()`

Design intent:
- `init` is called once.
- `onToggle(true)` may happen multiple times over runtime; make enable idempotent.
- `onToggle(false)` must clean up scripts, timers, listeners, and vendor globals where possible.

## Integration Workflow (Step-by-Step)

### 1) Define plugin scope and routing behavior

Before coding, answer:
- Which events should this plugin consume (`identify`, `reset`)?
- Should calls be dropped, queued, or forwarded when plugin is disabled?
- Does it need user context (`userId`, `traits`) from `identify`?

Then map behavior into `EventRouter` rules.

### 2) Add plugin implementation

Create `src/plugins/<plugin-name>/<PluginName>Plugin.ts`.

Use existing plugin patterns:
- `src/plugins/onesignal/OneSignalPlugin.ts` (notification integration)
- `src/plugins/gamification/GamificationPlugin.ts`

Implementation requirements:
- Load external script lazily in `onToggle(true)`.
- Guard against duplicate injections (`querySelector(script[src=...])` + marker attr).
- Wait for vendor global readiness with timeout/polling when needed.
- Fail safely (do not crash host page on vendor/network failures).
- Teardown on `onToggle(false)`:
  - call vendor logout/destroy APIs if available,
  - remove script tags from DOM,
  - clear plugin-held state,
  - clear global references best-effort (`delete` with fallback to `undefined`).

### 3) Register plugin in hub and facade

Current registry keys are fixed in `Hub`:
- `notification`, `gamification`

To add a new plugin:
- Update integration key union and defaults (`src/config/schema.ts`, `src/types.ts`).
- Update hub plugin order and registration (`src/hub/Hub.ts`).
- Instantiate plugin in facade wiring (`src/global.ts`).
- Add event routing behavior in `src/hub/EventRouter.ts`.

Important: `plugin.name` must exactly match the key used in hub registry.

### 4) Extend control config parsing

`ControlService` currently consumes parsed toggles from `parseControlConfig`.

When adding a new integration:
- Add key to `IntegrationKey`.
- Add default toggle in parser.
- Ensure strict parser (`tryParseControlConfig`) validates new key.
- Keep backward compatibility: unknown fields ignored, missing fields default-safe.

### 5) Add/adjust tests

Required tests for new plugin:
- Script injection on enable.
- No duplicate script injection on repeated enable.
- Vendor API mapping for supported hooks.
- Teardown behavior on disable (`destroy/logout`, script removal, global cleanup).
- Failure safety (script load failure/timeout does not crash runtime).

And integration-level tests:
- Router calls plugin only when expected.
- Routing semantics when other integrations are off (see `EventRouter`).
- Toggle transitions trigger `onToggle` correctly.

Test locations:
- `test/<PluginName>Plugin.test.ts`
- related router/hub tests (`test/EventRouter.test.ts`, `test/hub-*.test.ts`, `test/global-api.test.ts`)

## Current Architecture Caveats (As-Is)

Be aware of current behavior while integrating:
- `Hub` currently calls `plugin.init(ctx, {})` with empty config object.
- Per-plugin remote integration config wiring is limited; many plugins rely on defaults unless further wired.
- Pre-first-config API calls are queued in `global.ts` and flushed once first control sync resolves.

Design your plugin to behave safely under these constraints.

## Developer Checklist (Definition of Done)

- [ ] Plugin file added under `src/plugins/<name>/`.
- [ ] Plugin implements `Plugin` contract and idempotent toggle lifecycle.
- [ ] Hub registry updated with correct integration key/name.
- [ ] Control schema + toggle defaults updated.
- [ ] EventRouter routing rules updated.
- [ ] Unit tests added for plugin lifecycle + vendor mapping.
- [ ] Integration tests updated for router/toggle behavior.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] README/docs updated if consumer-facing behavior changes.

## Common Pitfalls

- Calling vendor globals directly from consumer-facing code instead of plugin internals.
- Initializing vendor SDK in `init` instead of lazy enable path.
- Forgetting to remove script tags and global variables on disable.
- Missing retries/timeouts and causing hanging enable states.
- Not handling repeated toggle transitions safely.
- Letting one plugin failure break entire SDK flow.

## Suggested Plugin Template

Use this as a minimal skeleton:

```ts
import type { HubContext, Plugin } from "../types";

export class ExamplePlugin implements Plugin {
  public readonly name = "example";

  private ctx!: HubContext;
  private active = false;

  init(ctx: HubContext, _config: unknown): void {
    this.ctx = ctx;
  }

  onToggle(enabled: boolean): void {
    this.active = enabled;
    if (enabled) {
      void this.enable();
    } else {
      this.disable();
    }
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    if (!this.active) return;
    void userId;
    void traits;
  }

  reset(): void {
    if (!this.active) return;
  }

  private async enable(): Promise<void> {
    // script load + vendor init
  }

  private disable(): void {
    // vendor teardown + script/global cleanup
  }
}
```
