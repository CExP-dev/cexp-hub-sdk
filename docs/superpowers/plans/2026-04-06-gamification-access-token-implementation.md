# Gamification CDP access token — implementation plan

> **Status: COMPLETED (2026-04).** CDP JWT flow (`gamificationToken.ts`, refresh scheduling, Hub wiring) is implemented. This plan is retained as historical reference only.

> **Spec (normative):** [../specs/2026-03-30-version-management-design.md](../specs/2026-03-30-version-management-design.md) — section **Gamification CDP access token**  
> **Tracking:** Use checkbox steps (`- [ ]`) while implementing.

---

## Goal

Implement the **CDP JWT** path for gamification:

1. **`GET {tokenBaseUrl}/sv/token`** with **`X-Client-Key: <clientKey>`** returns a **JWT** (access token).
2. Use that JWT as the value passed into **`new window.cexp({ apiKey: jwt })`** (same constructor parameter name as today).
3. Run **after** token success: load **`cexp-gamification`** from jsDelivr (unchanged URL builder), then **`init()`**.
4. **v1 refresh (“A-only”):** decode JWT **`exp`**, schedule refresh **before** expiry (skew, e.g. 60s); on refresh, **`destroy`** (if present) + recreate client + **`init()`**; clear timer on disable/destroy.
5. If **`clientKey`** and **`tokenBaseUrl`** are not both set, use static **`apiKey`** for the vendor SDK (no CDP HTTP call, no JWT refresh).

**Out of scope (v1):** Reactive retry on auth errors (“C”); **`init()`** override for **`tokenBaseUrl`** (optional follow-up).

---

## Acceptance criteria

- [ ] Control JSON may include **`integrations.gamification.clientKey`** and **`integrations.gamification.tokenBaseUrl`**; parsed only when validation passes.
- [ ] **Precedence:** Non-empty **`clientKey`** + valid **`tokenBaseUrl`** → CDP JWT fetch + refresh; **`apiKey`** from remote config is **not** used for SDK init when those CDP fields are present (document in code comment or README if touched).
- [ ] **`tokenBaseUrl`** is **`https`**, allowlisted, no trailing slash; invalid values omitted at parse time (same spirit as **`packageVersion`**).
- [ ] Token fetch runs **before** script injection; token fetch failure → **no** script load, **no** `window.cexp` init.
- [ ] **`Hub.setControlConfig`** treats changes to **`clientKey`** or **`tokenBaseUrl`** like **`apiKey`** / **`packageVersion`** changes (reload/re-init path when gamification is enabled or when disabled-but-storing config).
- [ ] **`npm test`** and **`npm run lint`** pass.

---

## Architecture overview

```mermaid
sequenceDiagram
  participant CS as ControlService
  participant Hub as Hub
  participant GP as GamificationPlugin
  participant CDP as CDP tokenBaseUrl
  participant CDN as jsDelivr

  CS->>Hub: setControlConfig (clientKey, tokenBaseUrl, …)
  Hub->>GP: init / onToggle
  GP->>CDP: GET …/sv/token, X-Client-Key
  CDP-->>GP: JWT
  GP->>CDN: load cexp-gamification script
  GP->>GP: new cexp({ apiKey: JWT }); init()
  Note over GP: Timer fires at exp - skew: refetch JWT, destroy, recreate
```

---

## Task 1 — Control schema and types

**Files:** `src/config/schema.ts`, tests under `test/` (e.g. `parseControlConfig` tests).

- [x] **1.1** Extend **`GamificationIntegrationToggleConfig`** with optional **`clientKey?: string`** and **`tokenBaseUrl?: string`**.
- [x] **1.2** In **`parseControlConfig`** / **`tryParseControlConfig`**, parse optional fields:
  - **`clientKey`:** reuse **`safeNonEmptyString`** (or equivalent).
  - **`tokenBaseUrl`:** `https` only; strip trailing `/` or reject; max length; **host/path allowlist** (coordinate with security — e.g. `*.cads.live` and path prefix). On failure, **omit** the field (do not break the whole block).
- [x] **1.3** Ensure **`areControlConfigsEqual`** (if used for equality) remains correct when new fields exist, or document that gamification hot-reload uses **`Hub`** field-wise comparison (Task 4).

**Tests:** Valid pair preserved; invalid **`tokenBaseUrl`** dropped; **`apiKey`**-only configs (no CDP fields) unchanged.

---

## Task 2 — Token helper module

**Files:** e.g. `src/plugins/gamification/gamificationToken.ts`, `test/gamificationToken.test.ts`.

- [x] **2.1** **`buildTokenUrl(tokenBaseUrl: string): string`** → `tokenBaseUrl` + `/sv/token` with no double slashes (normalize once).
- [x] **2.2** **`fetchGamificationAccessToken(args: { tokenBaseUrl: string; clientKey: string; fetcher?: typeof fetch }): Promise<string>`**
  - Method **GET**, header **`X-Client-Key`**, appropriate **`Accept`** if backend requires it.
  - **2xx** only; else throw or **`Result`** type — caller must not load script.
- [x] **2.3** **`normalizeTokenResponseBody(text: string): string`** — trim; if JSON parse succeeds, read **`token`** or **`access_token`**; else treat whole body as JWT string.
- [x] **2.4** **`decodeJwtExpSeconds(jwt: string): number | undefined`** — split JWT, base64url-decode payload, **`JSON.parse`**, read **`exp`** (number).
- [x] **2.5** **`msUntilRefresh(expSec: number, skewMs: number, nowMs: number): number`** — return **`max(0, expSec * 1000 - skewMs - nowMs)`**; document behavior if token already expired (immediate refresh vs fail).

**Tests:** Fixed JWT fixtures; mocked **`fetch`**; edge cases (empty body, wrong JSON).

---

## Task 3 — `GamificationPlugin`

**Files:** `src/plugins/gamification/GamificationPlugin.ts`, extend or add tests under `test/`.

- [x] **3.1** Extend **`parseGamificationConfig`** (or equivalent) to read **`clientKey`** and **`tokenBaseUrl`** from plugin config.
- [x] **3.2** **Credentials:** If **`clientKey`** and **`tokenBaseUrl`** are both non-empty → CDP JWT path (`fetchGamificationAccessToken`, refresh timer). Otherwise → static **`apiKey`** only (no CDP request). One normalized config shape; no separate “modes” in code or docs.
- [x] **3.3** **`enable()` (CDP path):** `fetchGamificationAccessToken` → existing **`ensureGamificationScriptLoaded`** → **`new Ctor({ apiKey: jwt })`** → **`init()`**. Inject **`fetch`** for tests (default **`globalThis.fetch`**).
- [x] **3.4** **Timer:** After successful **`init`**, schedule **`setTimeout`** for **`msUntilRefresh`**. Store **`timeoutId`**; **`clearTimeout`** on disable and before scheduling a new one.
- [x] **3.5** **On timer:** If plugin still **active**, fetch new JWT, **`destroy()`** client, set **`client`**, **`new Ctor`**, **`init()`**, reschedule from new JWT’s **`exp`**.
- [x] **3.6** **`disable()`:** Clear timer first, then existing script teardown and **`window.cexp`** cleanup.

**Tests:** jsdom + mocked **`fetch`** + fake timer if needed (`vi.useFakeTimers()`).

---

## Task 4 — `Hub` gamification config diff

**Files:** `src/hub/Hub.ts`, `test/` (Hub tests if present).

Current logic compares **`apiKey`** and **`packageVersion`** when **`enabled`** is unchanged (see **`setControlConfig`** gamification branch). Extend:

- [x] **4.1** Add **`clientKeyChanged`** and **`tokenBaseUrlChanged`** (strict equality on optional strings).
- [x] **4.2** Combine: **`apiKeyChanged || packageVersionChanged || clientKeyChanged || tokenBaseUrlChanged`** for the same **`init` / `onToggle`** refresh paths as today.

---

## Task 5 — Verification and documentation

- [x] **5.1** Run **`npm run lint`** and **`npm test`** from repo root.
- [x] **5.2** If **`README.md`** documents gamification only with **`apiKey`**, add one short paragraph for **`clientKey` + `tokenBaseUrl`** (only if you already maintain integration docs there).

---

## Task 6 — Commit

- [ ] **6.1** Single logical commit, e.g. **`feat(gamification): CDP JWT before script load and exp-based refresh`**.

---

## Dependencies (external)

- CDP exposes **`GET {tokenBaseUrl}/sv/token`** compatible with the normalizer (raw JWT or JSON wrapper).
- Platform provides **`tokenBaseUrl`** per environment via control JSON (e.g. `https://staging-cexp.cads.live/gamification`).

---

## Follow-ups (post–v1)

- Reactive “C”: retry once after vendor/auth failure.
- **`InitOptions`** override for **`tokenBaseUrl`** (local dev).
- Single-flight token refresh if **`track`** overlaps refresh (only if observed in production).
