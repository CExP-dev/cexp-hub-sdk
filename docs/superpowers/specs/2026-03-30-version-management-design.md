# Version management — design (hybrid)

**Status:** Draft for review  
**Related:** [../architecture/2026-03-20-cexp-hub-sdk-system-architecture.md](../architecture/2026-03-20-cexp-hub-sdk-system-architecture.md) (current hub); [../plans/2026-03-20-cexp-hub-sdk.md](../plans/2026-03-20-cexp-hub-sdk.md) (historical four-plugin plan); [../plans/2026-04-06-gamification-access-token-implementation.md](../plans/2026-04-06-gamification-access-token-implementation.md) (gamification token + refresh)

---

## Goal

Define a **best-practice, hybrid** policy for:

1. `**cexp-hub-sdk` releases** (npm / CDN SemVer).
2. **Vendor script / package versions** (OneSignal SDK, gamification `cexp-gamification`, etc.).

The policy must preserve **integrate once (evergreen snippet)**: consumer pages keep a single stable integration pattern (`script` + `CExP.init({ id })`); **consumers do not** edit script URLs for every vendor bump. Platform teams move behavior via **hub releases** and/or **backwards-compatible control API** updates.

---

## Principles


| Principle                            | Meaning                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evergreen consumer surface**       | Snippet URL strategy is stable (e.g. org-controlled alias or pinned major); not “edit HTML every week.”                                                                      |
| **Hub SemVer**                       | `cexp-hub-sdk` version reflects **public API** and **hub compatibility** (breaking changes → major, etc.).                                                                   |
| **Hybrid vendor pins**               | **Security- and behavior-sensitive** pins live in **hub code** (reviewed releases). **Safe, semver-stable** knobs may be **remote** when explicitly supported and validated. |
| **Backward-compatible control JSON** | Unknown fields ignored; new optional keys added; existing consumers of the API keep working.                                                                                 |


Diagrams use [Mermaid](https://mermaid.js.org/); render in GitHub, VS Code (preview), or any Mermaid-compatible viewer.

---

## Diagrams

### System context: who owns “version”

High-level view: **consumer HTML stays stable**; **hub SemVer** and **vendor pins** are platform-owned; **control JSON** can tune safe remote fields.

```mermaid
flowchart TB
  subgraph consumer [Consumer site — evergreen]
    HTML[Stable script URL + CExP.init]
  end

  subgraph hubPkg [cexp-hub-sdk — SemVer npm / CDN]
    CExP[window.CExP facade]
    Plugins[Internal plugins]
  end

  subgraph control [CExP platform — control API]
    CFG[JSON: toggles + optional integration config]
    Vcfg["version number (config identity, not npm)"]
  end

  subgraph vendors [Vendor scripts — lazy-loaded]
    V1[OneSignal SDK URL…]
    V2[cexp-gamification@semver]
  end

  HTML --> CExP
  CExP --> CFG
  CFG --> Vcfg
  CExP --> Plugins
  Plugins --> V1
  Plugins --> V2
```



### Version layers (stack)

```mermaid
flowchart TB
  L1["Layer 1: Hub package SemVer (package.json / CExP.version)"]
  L2a["Layer 2a: Hub-pinned vendor URLs (e.g. OneSignal SDK)"]
  L2b["Layer 2b: Remote-config knobs (e.g. gamification packageVersion, apiKey or clientKey+tokenBaseUrl)"]
  L3["Layer 3: Control API version field (ETag / change detection)"]

  L1 --> L2a
  L1 --> L2b
  L3 --> L2b
```



### Hybrid split: hub release vs backend-only change

```mermaid
flowchart TD
  Q[Vendor or integration change]
  Q --> H{Breaking API, new script host, or hub logic change?}
  H -->|Yes| R1[New cexp-hub-sdk release + CI + deploy npm/CDN]
  H -->|No| Q2{Only safe remote fields e.g. gamification semver?}
  Q2 -->|Yes + wired| R2[Update control API config for sdkId — optional: no hub release]
  Q2 -->|No / not wired| R1
```



### Operational playbook (three paths)

```mermaid
flowchart LR
  subgraph p1 [Path 1 — Gamification semver + credentials]
    A1[Backend sets packageVersion + apiKey OR clientKey + tokenBaseUrl] --> A2[Hub applies after fetch]
  end

  subgraph p2 [Path 2 — Hub-pinned URL change]
    B1[Edit constants in repo] --> B2[Hub release + tests]
  end

  subgraph p3 [Path 3 — Public CExP API]
    C1[SemVer + changelog] --> C2[Publish]
  end
```



---

## Layer 1: Hub package (`cexp-hub-sdk`)

- **Source of truth:** `package.json` `"version"` (SemVer).
- **Runtime:** `CExP.version` (or exported `version`) **must match** the published package version for that build — avoid drift between a string constant and `package.json` (implementation: generate or inject at build time).
- **When to release a new hub version**
  - Public API or default behavior change.
  - Change to **hub-pinned** vendor URLs/paths (see below).
  - New or changed **initialization / teardown** logic for a plugin.
  - Compatibility shims for a vendor upgrade that cannot be expressed safely by config alone.

**Release artifacts:** npm publish + `dist/` (ESM + IIFE); CDN consumers pin `cexp-hub-sdk@<version>` or use a **single stable URL** your team redirects to a tested version.

---

## Layer 2: Vendor pins — hybrid split

### A. Hub-pinned (default for sensitive integrations)

These are **fixed in source** (constants), covered by tests, and updated **only** via a **new hub release**:

- **OneSignal:** SDK script URL (e.g. `cdn.onesignal.com/.../OneSignalSDK.page.js` major path).
- **Gamification (default script host):** jsDelivr URL pattern for `cexp-gamification` (version segment may be remote-controlled when allowlisted fields are wired).

**Rationale:** URL or init-pattern changes affect CSP, security, and correctness; they should go through code review and CI.

### B. Remote-config (optional knobs; allowlisted)

When the **control API** and **parser** support it, **non-secret** per-integration fields may override **safe** defaults:

- **Gamification:** `packageVersion` (npm semver or dist-tag for `cexp-gamification` on jsDelivr), and **either** a static `apiKey` **or** a **CDP access-token flow** (see [Gamification CDP access token](#gamification-cdp-access-token) below). **Wiring from `ControlService` → `Hub` → `plugin.init(ctx, config)`** is required for remote rollout without a hub release (defaults remain in hub code).

**Rules for remote pins:**

- **Validation:** Only allowlisted keys; URLs (if ever allowed) must match an **allowlist** of host/path patterns.
- **Fallback:** If remote payload is missing or invalid, use **hub defaults** (same as today).
- **Documentation:** Control API contract versioned separately; additive changes only unless major platform bump.

### C. When vendor changes still require a hub release

Even in hybrid mode, a **new hub release** is required when:

- Vendor **breaking** API (init signature, global name, teardown contract) cannot be hidden behind existing config.
- **CSP / security** policy requires a new script host or path not on the allowlist.
- You need new **hub logic** (router behavior, plugin lifecycle, queue rules).

---

## Gamification CDP access token

This section extends Layer 2 for integrations that **do not** pass a long-lived `apiKey` string directly. Instead the hub exchanges a **client key** for a **short-lived JWT** and passes that JWT into the vendor SDK as the same `apiKey` parameter the script expects.

### Goals

1. **Fetch access token before** loading the gamification script (`cexp-gamification` on jsDelivr) and before `new window.cexp({ apiKey })`.
2. Support **multiple environments** without hardcoding host lists in the SDK: the **control JSON** supplies **`tokenBaseUrl`** per deployment (staging vs production, etc.).
3. **Refresh tokens proactively** using the JWT `exp` claim (**v1 = “A-only”**): schedule refresh shortly before expiry; **reactive retry on 401 / auth failure** is a **later** improvement (“C”), not required in v1.

### Control JSON fields (`integrations.gamification`)

| Field | Required | Purpose |
| ----- | -------- | ------- |
| `clientKey` | For token flow | Non-empty string sent as `X-Client-Key` to the CDP token endpoint. |
| `tokenBaseUrl` | For token flow | HTTPS origin + path prefix for the gamification API in that environment (e.g. `https://staging-cexp.cads.live/gamification`). **No trailing slash.** The hub calls `GET {tokenBaseUrl}/sv/token`. |
| `apiKey` | Legacy / alternate | If **`clientKey` is absent**, use **`apiKey`** as today (static string passed to the vendor SDK). |
| `packageVersion` | Optional | Unchanged: semver/dist-tag for jsDelivr. |

**Precedence:** If `clientKey` is present (and token flow is wired), **use the token path** and **ignore remote `apiKey` for initialization** (or treat `apiKey` as unused in that mode — document one rule for integrators). If `clientKey` is absent, **keep backward-compatible behavior** with `apiKey` only.

### Token HTTP contract

- **Request:** `GET {tokenBaseUrl}/sv/token` with header `X-Client-Key: <clientKey>`, `Accept` as needed for the API (typically `application/json` or negotiate with backend).
- **Response:** Body yields a **JWT string** (either **raw body** or a JSON field such as `token` / `access_token` — implementation normalizes to a single string before parsing `exp`).
- **Expiry:** Decode JWT payload (standard base64url); read `exp` (seconds since Unix epoch). Do **not** trust client clock for security boundaries; **do** use `exp` for scheduling refresh with a **skew** (e.g. 60s) before expiry.

### v1 refresh behavior (“A-only”)

- After obtaining a JWT, schedule **one timer** to run at `exp * 1000 - skewMs`.
- When the timer fires, if gamification is still enabled: **fetch a new JWT**, then **tear down** the vendor client (`destroy` if available) and **recreate** `new cexp({ apiKey: newJwt })` + `init()` unless a lighter API exists (prefer destroy+recreate for v1 clarity).
- On **disable/destroy**: clear timers, then existing teardown (remove script tag, clear globals).

**Future (“C”):** add reactive refetch + single retry when the vendor surfaces auth errors, in addition to proactive refresh.

### Environment management

- **Primary:** Backend includes **`tokenBaseUrl`** in control JSON per `sdkId`/environment so the **same hub build** works everywhere; URLs can change without an npm release.
- **Optional later:** `init({ id, … })` override for `tokenBaseUrl` for local dev and tests (product decision; not required for v1 if mocks cover `fetch`).

### Security and validation

- Validate **`tokenBaseUrl`**: `https` only, reasonable length, and (recommended) an **allowlist** of host/path patterns agreed with platform security — same spirit as other remote URL knobs.
- **Secrets:** `clientKey` is sensitive; treat like other integration secrets in logs (no console dumps).

---

## Layer 3: Control API `version` field

The existing `**version` number** on control JSON is for **config identity / change detection** (with ETag), not npm SemVer. Keep it **monotonic** per platform convention. Hub **must** remain tolerant of unknown fields and treat missing integration blocks as safe defaults.

---

## Operational playbook (summary)

1. **Routine gamification bump (semver only):** If remote `packageVersion` + credentials are wired and validated → update **backend config** for `sdkId` → no hub release (optional). Credentials are either **`apiKey`** (legacy) or **`clientKey` + `tokenBaseUrl`** (CDP JWT flow).
2. **Environment / CDP base URL change:** Prefer updating **`tokenBaseUrl`** (and related fields) in **control JSON** per environment; hub release only if validation rules or token path logic changes.
3. **OneSignal SDK URL change or gamification default script path change:** **Hub release** + tests + deploy CDN/npm.
4. **New public `CExP` API:** **Hub SemVer** bump per semver rules + changelog.

---

## Testing expectations

- **Hub release:** Unit/integration tests for each plugin’s load URL, init, teardown, and router behavior after pin changes.
- **Remote config:** Tests for parse/merge: defaults, valid remote override, invalid remote ignored, allowlist rejection.
- **Gamification token flow:** Unit tests for JWT `exp` parsing, refresh scheduling, and mocked `fetch` for `GET …/sv/token`; integration tests for plugin enable/disable with token path vs legacy `apiKey`.

---

## Open decisions (implementation phase)

1. **Build-time `CExP.version`:** Use `define` from bundler, `import package.json`, or codegen — single source of truth.
2. **Extend `parseControlConfig` / `ControlConfig`** to carry optional per-integration blobs (e.g. `gamification: { enabled, packageVersion?, apiKey?, clientKey?, tokenBaseUrl? }`) without breaking strict parse paths — follow “unknown fields ignored” at top level; integration blocks may grow additively.
3. **Exact token response shape:** Confirm with backend whether the body is raw JWT vs JSON wrapper; implement a small normalizer.
4. **`tokenBaseUrl` allowlist:** Exact host/path patterns for staging vs production (must match platform security review).
5. **Snippet strategy for consumers:** Document “pin `@x.y.z`” vs “org alias URL” as a **product** choice (both compatible with evergreen philosophy if the URL is stable).
6. **Init-time override** for `tokenBaseUrl` (optional): defer to a follow-up if remote-only config suffices for v1.

---

## Approval

- Product / platform owner agrees with **hub-pinned vs remote** split.
- Backend team agrees on **control JSON** shape for optional gamification fields (including **`clientKey`** + **`tokenBaseUrl`** for the CDP token flow).
- Ready for implementation plan: [../plans/2026-04-06-gamification-access-token-implementation.md](../plans/2026-04-06-gamification-access-token-implementation.md).

