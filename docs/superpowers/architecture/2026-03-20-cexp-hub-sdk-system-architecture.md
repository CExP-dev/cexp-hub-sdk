# CExP Hub SDK — system architecture

This document reflects the architecture described in the implementation plan: [../plans/2026-03-20-cexp-hub-sdk.md](../plans/2026-03-20-cexp-hub-sdk.md).

Diagrams use [Mermaid](https://mermaid.js.org/); render in GitHub, VS Code (preview), or any Mermaid-compatible viewer.

---

## Integration philosophy (integrate once, never touch script again)

Consumers embed a single stable CDN script snippet (e.g. `window.CExP`) one time. After that, toggles and integration behavior are driven by your backend (control/toggle polling), and the SDK injects vendor scripts lazily per integration. This lets your platform evolve without forcing consumers to update their snippet.

## 1. System context (who talks to whom)

Actors: **Consumer** (developer who embeds the script), **End user** (browser visitor), **CExP backend** (your config/toggles), **third-party / in-house services**.

```mermaid
flowchart TB
  subgraph consumerEnv [Consumer website]
    Site[Host web app HTML or SPA]
    Script[CExP bundle window.CExP]
    Site --> Script
  end

  subgraph endUser [End user browser]
    Browser[Browser session]
  end

  Script --> Browser

  subgraph cexpBackend [CExP platform]
    ConfigAPI[SDK config and toggles API]
  end

  subgraph vendors [Integrations and data plane]
    SnowplowCol[Snowplow collector]
    OneSignalSvc[OneSignal]
    CdpHost[cdp.js host]
    GamCDN[Gamification script CDN]
  end

  Consumer[Consumer developer] -.->|"pastes snippet and sdkId"| Site
  EndUserPerson[End user] --> Browser

  Script -->|"GET config sdkId ETag poll 5m"| ConfigAPI
  Script -->|"lazy load/enable Snowplow"| SnowplowCol
  Script -->|"lazy load/enable OneSignal (Deferred init)"| OneSignalSvc
  Script -->|"lazy load/enable cdp.js"| CdpHost
  Script -->|"lazy load/enable cexp-web-sdk"| GamCDN
```

---

## 2. Logical containers inside the browser

Single **hub process** in the page: public API is only `CExP`; plugins are internal.

```mermaid
flowchart TB
  subgraph publicAPI [Public surface only]
    CExP[window.CExP]
  end

  subgraph hubRuntime [Hub runtime in bundle]
    Hub[Hub orchestrator]
    ControlSvc[ControlService]
    Enricher[ContextEnricher]
    Router[EventRouter]
    IdStore[IdentityStore]
    SpaHook[SpaPageView]
  end

  subgraph plugins [Internal plugins not exposed to consumers]
    PIdent[CdpIdentityPlugin]
    PSnow[SnowplowPlugin]
    POne[OneSignalPlugin]
    PGam[GamificationPlugin]
  end

  CExP --> Hub
  Hub --> ControlSvc
  Hub --> Enricher
  Hub --> Router
  Hub --> IdStore
  Hub --> SpaHook

  Router --> PSnow
  Router --> POne
  Router --> PGam
  IdStore --> PIdent
  Hub --> PIdent

  SpaHook -->|"virtual page"| Router
```

---

## 3. Request and event flow (high level)

```mermaid
flowchart LR
  subgraph initPhase [After CExP.init id]
    A[init with sdkId] --> B[ControlService fetch config]
    B --> C[Apply toggles and integration config]
    C --> D[Lazy-load enabled plugins]
    D --> E[Start SPA hooks and polling]
  end

  subgraph runtimePhase [Runtime]
    T[CExP.track] --> F[ContextEnricher]
    P[CExP.page or SPA hook] --> F
    I[CExP.identify] --> F
    F --> G[EventRouter]
    G -->|"per toggle and rules"| H[Plugins]
  end
```

### OneSignal deferred embed (used internally)

When `onesignal.enabled` is true, the hub injects the OneSignal script and performs deferred initialization using the pattern below (consumer never touches OneSignal vendor globals):

```html
<script
  src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
  defer
></script>
<script>
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function (OneSignal) {
    await OneSignal.init({
      appId: `${onesignal_app_id}`,
    });
  });
</script>
```

---

## 4. Control and toggle loop

```mermaid
sequenceDiagram
  participant App as Host page
  participant CExP as CExP Hub
  participant Ctrl as ControlService
  participant API as CExP config API

  App->>CExP: init id sdkId
  CExP->>Ctrl: start
  Ctrl->>API: GET config If-None-Match ETag
  API-->>Ctrl: 200 body or 304
  Ctrl-->>CExP: toggles plus integration config
  CExP->>CExP: init or update plugins

  loop Every 5 minutes
    Ctrl->>API: GET conditional request
    API-->>Ctrl: 200 or 304
    Ctrl-->>CExP: update toggles if changed
    CExP->>CExP: onToggle plugins
  end
```

---

## 5. Identity and anonymous id (`fpt_uuid`)

```mermaid
flowchart TB
  subgraph identityFlow [Identity path]
    Cdp[CdpIdentityPlugin loads cdp.js]
    Fpt[fpt_uuid from cdp sync]
    Store[IdentityStore localStorage plus cookie]
  end

  Cdp --> Fpt
  Fpt --> Store
  Store --> Router[EventRouter and plugins]

  Known[CExP.identify userId traits] --> Router
  Reset[CExP.reset clears user keeps fpt_uuid] --> Router
```

---

## 6. Event routing rules (plan snapshot)

| Integration | Toggle off behavior (planned) |
|---------------|-------------------------------|
| Snowplow | Queue **identify** only; drop **track** and **page** |
| OneSignal | Clear user or subscription association per vendor API |
| Gamification | Drop gamification-bound calls; script loaded when enabled (lazy) |
| Identity | Drives `fpt_uuid`; storage localStorage plus cookie fallback |

```mermaid
flowchart TB
  E[Incoming track page identify] --> R[EventRouter]
  R -->|"snowplow on"| S[SnowplowPlugin]
  R -->|"snowplow off"| Q[Identify queue only]
  R -->|"onesignal on"| O[OneSignalPlugin]
  R -->|"gamification on"| G[GamificationPlugin]
```

---

## Related

- Implementation tasks and file layout: [../plans/2026-03-20-cexp-hub-sdk.md](../plans/2026-03-20-cexp-hub-sdk.md)
