# CExP Hub SDK — system architecture

This document reflects the architecture described in the implementation plan: [../plans/2026-03-20-cexp-hub-sdk.md](../plans/2026-03-20-cexp-hub-sdk.md).

Diagrams use [Mermaid](https://mermaid.js.org/); render in GitHub, VS Code (preview), or any Mermaid-compatible viewer.

---

## Integration philosophy

**Integrate once, never touch script again.** Consumers embed a single stable CDN script snippet one time. After that, toggles and integration behavior are driven by your backend (control/toggle polling), and the SDK injects/removes vendor scripts lazily per integration. This lets your platform evolve without forcing consumers to update their snippet.

**All four integrations have toggles.** Identity (cdp.js), tracking (Snowplow), notifications (OneSignal), and gamification are each independently togglable from the backend config. When toggled on, the vendor script is lazy-loaded and initialized. When toggled off, the plugin is destroyed and its `<script>` tag is **removed from the DOM**.

---

## 1. Key integration details

| Integration | Script source | Global | Hub role |
| --- | --- | --- | --- |
| Identity | `octopus-stream01-cads.fpt.vn/cdp.js` | `window.cdpFpt` | Segment Analytics.js fork. **Identity only** — `fpt_uuid` management, cross-domain sync. Event pipeline disabled. |
| Tracking | `cexp.fpt.com/sdk/acti/cdp.js` | `window.snowplow` | Self-hosted Snowplow sp.js tracker. All event capture: `trackSelfDescribingEvent`, `trackPageView`, `enableActivityTracking`. |
| Notifications | `cdn.onesignal.com/.../OneSignalSDK.page.js` | `window.OneSignalDeferred` | Web push via OneSignalDeferred init pattern. |
| Gamification | `cdn.jsdelivr.net/.../cexp-web-sdk.js` | `window.cexp` | In-house gamification. `new window.cexp({ apiKey })` + `init()`. |

---

## 2. System context (who talks to whom)

```mermaid
flowchart TB
  subgraph consumerEnv [Consumer website]
    Site[Host web app / SPA]
    Script["CExP bundle (window.CExP)"]
    Site --> Script
  end

  subgraph endUser [End user browser]
    Browser[Browser session]
  end

  Script --> Browser

  subgraph cexpBackend [CExP platform]
    ConfigAPI[SDK config + toggles API]
  end

  subgraph vendors [Vendor scripts — lazy loaded per toggle]
    SnowplowCol["Snowplow collector\n(octopus-stream01-cads.fpt.vn)"]
    OneSignalSvc[OneSignal]
    CdpHost["cdp.js host\n(octopus-stream01-cads.fpt.vn/cdp.js)"]
    GamCDN[Gamification CDN]
  end

  Consumer[Consumer developer] -.->|"pastes snippet + sdkId"| Site
  EndUserPerson[End user] --> Browser

  Script -->|"GET config (sdkId, ETag, poll 5m)"| ConfigAPI
  Script -->|"toggle on: inject + init\ntoggle off: destroy + remove"| SnowplowCol
  Script -->|"toggle on: inject + init\ntoggle off: destroy + remove"| OneSignalSvc
  Script -->|"toggle on: inject + init\ntoggle off: destroy + remove"| CdpHost
  Script -->|"toggle on: inject + init\ntoggle off: destroy + remove"| GamCDN
```

---

## 3. Logical containers inside the browser

Single hub process in the page. Public API is only `CExP`; plugins are internal.

```mermaid
flowchart TB
  subgraph publicAPI [Public surface only]
    CExP["window.CExP"]
  end

  subgraph hubRuntime [Hub runtime — bundled]
    Hub[Hub orchestrator]
    ControlSvc[ControlService]
    Router[EventRouter]
    IdStore[IdentityStore]
    SpaHook[SpaPageView]
    PreQ["Pre-init queue\n(before config arrives)"]
  end

  subgraph plugins [Internal plugins — not exposed to consumers]
    PIdent[CdpIdentityPlugin]
    PSnow[SnowplowPlugin]
    POne[OneSignalPlugin]
    PGam[GamificationPlugin]
  end

  CExP --> Hub
  Hub --> ControlSvc
  Hub --> Router
  Hub --> IdStore
  Hub --> SpaHook
  Hub --> PreQ

  Router --> PSnow
  Router --> POne
  Router --> PGam
  IdStore --> PIdent
  Hub --> PIdent

  SpaHook -->|"virtual page"| Router
```

---

## 4. Request and event flow

```mermaid
flowchart LR
  subgraph initPhase ["CExP.init({ id })"]
    A["init(sdkId)"] --> B[ControlService fetch config]
    B --> C[Apply toggles]
    C --> D["Lazy-load enabled plugins\n(inject scripts)"]
    D --> E[Flush pre-init queue]
    E --> F[Start SPA hooks + 5m polling]
  end

  subgraph runtimePhase [Runtime events]
    T["CExP.track()"] --> G[EventRouter]
    P["CExP.page() / SPA hook"] --> G
    I["CExP.identify()"] --> G
    G -->|"per toggle rules"| H[Enabled plugins]
  end
```

### Pre-init queue

Calls made before the first config fetch completes are held in a queue. Once config arrives and plugins are initialized, the queue is flushed through the EventRouter in FIFO order. No events are dropped during init.

---

## 5. Control and toggle loop

```mermaid
sequenceDiagram
  participant App as Host page
  participant CExP as CExP Hub
  participant Ctrl as ControlService
  participant API as CExP config API

  App->>CExP: init({ id: sdkId })
  CExP->>Ctrl: start
  Ctrl->>API: GET config (If-None-Match: ETag)
  API-->>Ctrl: 200 (body) or 304

  alt 200 — new config
    Ctrl-->>CExP: toggles + integration config
    CExP->>CExP: lazy-load / destroy plugins per toggles
  else 304 — unchanged
    Ctrl-->>CExP: no change
  end

  loop Every 5 minutes
    Ctrl->>API: GET (conditional)
    API-->>Ctrl: 200 or 304
    Ctrl-->>CExP: update toggles if changed
    CExP->>CExP: onToggle — load or destroy plugins
  end
```

---

## 6. Toggle lifecycle

When a plugin's toggle transitions, the hub performs:

```mermaid
flowchart LR
  subgraph toggleOn ["Toggle: off → on"]
    A1["Inject vendor <script>"] --> A2["Wait for global\n(window.snowplow, etc.)"]
    A2 --> A3["Initialize plugin\n(newTracker, OneSignal.init, etc.)"]
    A3 --> A4["Plugin active — receives events"]
  end

  subgraph toggleOff ["Toggle: on → off"]
    B1["Call plugin.destroy()"] --> B2["Remove <script> from DOM"]
    B2 --> B3["Clean up globals\nwhere possible"]
    B3 --> B4["Plugin inactive — events dropped/queued"]
  end
```

---

## 7. Identity and anonymous id (`fpt_uuid`)

`cdp.js` (`window.cdpFpt`) is a **Segment Analytics.js 3.x fork** used exclusively as an identity layer. Its event pipeline (sends to `/analytics/t`, `/p`, `/i`) is **disabled** by the hub — only the user/identity API is used.

```mermaid
flowchart TB
  subgraph identityFlow [Identity path]
    Toggle{"identity\ntoggle on?"}
    Cdp["CdpIdentityPlugin\nloads cdp.js"]
    Disable["Disable cdpFpt\nevent pipeline"]
    Fpt["fpt_uuid from cdpFpt\nuser().anonymousId()"]
    Sync["Backend sync\n(/analytics/sync_user)"]
    Store["IdentityStore\nlocalStorage + cookie"]
  end

  Toggle -->|yes| Cdp
  Cdp --> Disable
  Cdp --> Fpt
  Fpt --> Sync
  Fpt --> Store

  Toggle -->|no| NoId["No fpt_uuid\n(Snowplow uses own domain_userid)"]

  Store --> Ctx["Custom context entity\non Snowplow events"]

  Known["CExP.identify(userId, traits)"] --> CtxUpdate["Update context entity\n(does NOT call setUserId)"]
  Reset["CExP.reset()"] --> Clear["Clear userId + traits\nretain fpt_uuid"]
```

### Custom context entity (attached to Snowplow events)

When both identity and Snowplow are enabled, every Snowplow event carries:

```json
{
  "schema": "iglu:com.fpt/cexp_identity/jsonschema/1-0-0",
  "data": {
    "fpt_uuid": "<from IdentityStore>",
    "userId": "<from CExP.identify, or null>",
    "traits": {}
  }
}
```

`CExP.identify(userId, traits)` does **not** call Snowplow's `setUserId()`. The business user identity is only passed through this custom context entity.

---

## 8. Event routing rules

| Integration | Toggle on | Toggle off |
| --- | --- | --- |
| **Identity** | `cdp.js` loaded; `fpt_uuid` generated, synced, stored | `cdp.js` not loaded; script removed from DOM; no `fpt_uuid` |
| **Snowplow** | `track` → `trackSelfDescribingEvent`; `page` → `trackPageView`; `identify` → update context entity | **Queue `identify`** (max 50, 30 min TTL); **drop** `track` + `page`; script removed from DOM |
| **OneSignal** | `identify` → associate user; push subscriptions active | Clear user/subscription; script removed from DOM |
| **Gamification** | `track`/`identify` forwarded to SDK | Drop all calls; script removed from DOM |

```mermaid
flowchart TB
  E["Incoming: track / page / identify"] --> PQ{"Config\nresolved?"}
  PQ -->|no| Q["Pre-init queue"]
  PQ -->|yes| R[EventRouter]

  R -->|"snowplow on"| S[SnowplowPlugin]
  R -->|"snowplow off"| SQ["Queue identify\nDrop track/page"]
  R -->|"onesignal on"| O[OneSignalPlugin]
  R -->|"gamification on"| G[GamificationPlugin]

  S -->|"every event"| Ctx["+ fpt_uuid context entity"]
```

---

## 9. Snowplow integration details

The Snowplow tracker is self-hosted. The hub injects and configures it when the tracking toggle is enabled.

```mermaid
sequenceDiagram
  participant Hub as CExP Hub
  participant SP as Snowplow Tracker
  participant Col as Snowplow Collector

  Hub->>Hub: tracking toggle → on
  Hub->>SP: inject script (cexp.fpt.com/sdk/acti/cdp.js)
  Hub->>SP: newTracker("sp1", collectorUrl, config)
  Hub->>SP: enableActivityTracking(5s, 10s)

  Note over Hub,SP: CExP.track(eventName, props)
  Hub->>SP: trackSelfDescribingEvent({ schema, data }) + fpt_uuid context
  SP->>Col: POST /com.fpt/t

  Note over Hub,SP: CExP.page()
  Hub->>SP: trackPageView() + fpt_uuid context
  SP->>Col: POST /com.fpt/t

  Note over Hub,SP: Toggle off
  Hub->>SP: destroy
  Hub->>Hub: remove <script> from DOM
```

---

## Related

- Implementation tasks and file layout: [../plans/2026-03-20-cexp-hub-sdk.md](../plans/2026-03-20-cexp-hub-sdk.md)
