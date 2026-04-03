# CExP Hub SDK — Repository Folder Guide

This document explains the **purpose** of key folders in this repository, their **roles**, and **how they connect** at runtime.

**Current hub (2026-04):** two integrations — **OneSignal** and **gamification** — behind `CExP`; no Snowplow, identity (`cdp.js`), `IdentityStore`, or automatic SPA history listener.

## High-level architecture (how folders link together)

**Consumer app** calls the public API:

- `CExP.init({ id })`
- `CExP.track(...)`
- `CExP.page(...)`
- `CExP.identify(...)`
- `CExP.reset()`

Those calls flow through the SDK like this:

1. `src/index.ts` exports the public API (ESM).
2. `src/global.ts` (`createCExP()`) wires runtime components:
   - `ControlService` fetches and polls remote config
   - `Hub` manages plugin lifecycle and toggles
   - `EventRouter` routes events to enabled plugins
3. `src/config/schema.ts` validates/parses remote control JSON into a safe internal `ControlConfig` (`onesignal` + `gamification` only).
4. `src/plugins/*` provide the vendor behaviors (**OneSignal**, **gamification**).

### Relationship diagram

```mermaid
flowchart LR
  subgraph Consumer["Consumer App"]
    A["Calls `CExP.*`"]
  end

  subgraph Public["Public API surface"]
    B["`src/index.ts`\nexports `CExP` + functions"]
    C["`src/global.ts`\n`createCExP()` wiring"]
  end

  subgraph Control["Remote control config"]
    D["`src/hub/ControlService.ts`\nfetch + poll + onUpdate"]
    E["`src/config/schema.ts`\nparse/validate `ControlConfig`"]
  end

  subgraph Orchestration["Orchestration"]
    F["`src/hub/Hub.ts`\nplugin registry + toggles"]
    G["`src/hub/EventRouter.ts`\nroute track/page/identify/reset"]
  end

  subgraph Integrations["Integrations (`src/plugins/*`)"]
    P2["OneSignal"]
    P4["Gamification"]
  end

  A --> B --> C
  C --> D --> E
  D -- "onUpdate(config)" --> F
  C --> F
  F --> G
  G --> P2
  G --> P4
```

## Folder-by-folder

## `src/` — SDK source code

- **Role**: All runtime TypeScript for the SDK.
- **Links**:
  - `src/index.ts`: public ESM exports (`CExP`, `init`, `track`, …).
  - `src/global.ts`: creates the singleton facade and connects hub/router/control/config.
  - `src/types.ts`: public types (`CExPApi`, `InitOptions`, `IntegrationToggles`).

## `src/hub/` — orchestration layer (“the brain”)

- **Role**: Owns SDK lifecycle, remote-control config application, and event routing rules.
- **Key files**:
  - `ControlService.ts`
    - Fetches remote control config (ETag-aware), keeps last-good config, polls periodically, invokes `onUpdate`.
  - `Hub.ts`
    - Maintains deterministic plugin registry order (`onesignal`, then `gamification`).
    - Calls `plugin.init(ctx, config)` then `plugin.onToggle(enabled)` based on remote config.
  - `EventRouter.ts`
    - Delegates `track`/`page`/`identify`/`reset` to plugin hooks when the corresponding toggle is enabled.

## `src/plugins/` — integrations (vendor adapters)

- **Role**: Each plugin implements the shared `Plugin` interface (init, enable/disable, event hooks).
- **Links**:
  - `Hub` owns plugin lifecycle (`init`, `onToggle`).
  - `EventRouter` calls optional hooks (`track`, `page`, `identify`, `reset`) depending on toggles.
- **Examples**:
  - `src/plugins/onesignal/` — OneSignal web SDK.
  - `src/plugins/gamification/` — `cexp-gamification` / `window.cexp`.

## `src/config/` — remote control schema & parsing

- **Role**: Defines the safe internal config shape and parsing rules for remote control JSON.
- **Links**:
  - `ControlService` uses strict parsing (`tryParseControlConfig`) and equality checks to decide when to notify updates.
  - `Hub` reads `ControlConfig` and derives `IntegrationToggles`.

## `docs/` — documentation

- **Role**: Architecture notes and integration guidelines for consumers and plugin authors.
- **Links**: Documents the intended contract: consumer code must call only `CExP.*` (not vendor globals).

## `dist/` — build output (publishable artifacts)

- **Role**: Compiled/bundled output produced from `src/`.
- **Links**: Used by package exports and CDN usage (`dist/browser.global.js`, etc.).

## `test/` — automated tests

- **Role**: Validates behavior (control parsing, lifecycle toggles, routing rules).
- **Links**: Exercises modules from `src/` directly.

## `.github/` — GitHub automation

- **Role**: CI/workflows and GitHub settings.
- **Links**: Tooling only; not part of runtime behavior.

## `.cursor/` — editor/agent configuration

- **Role**: Cursor-specific configuration and guidance for dev/agent workflows.
- **Links**: Tooling only; not part of runtime behavior.
