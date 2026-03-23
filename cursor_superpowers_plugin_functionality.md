# Superpowers plugin functionality
_Exported on 3/23/2026 at 11:38:13 GMT+7 from Cursor (2.6.19)_

---

**User**

Show me how the Superpowers plugin works

---

**Cursor**

Here’s a concise picture of **how Superpowers fits into Cursor** and what each piece does.

## What it is

Superpowers is a **library of process skills** (and a few commands/agents) that steer *how* you work—planning, TDD, debugging, reviews, verification—not a single “button” feature. Cursor loads the skills; the model is nudged to **use the right skill before acting** when a task matches (e.g. debugging → systematic debugging, “done” → verification-before-completion).

## Skills (automatic + intentional)

These are the main workflows. You don’t have to memorize them: the agent is instructed to pick them when the task fits. You can also point at them in chat if you want a specific workflow.

| Skill | Role |
|--------|------|
| **using-superpowers** | Entry rule: if a skill might apply, use it first. |
| **brainstorming** | Before creative/feature work: clarify intent and design. |
| **writing-plans** | Turn a spec into a step-by-step plan before coding. |
| **executing-plans** | Run a written plan in another session with review checkpoints. |
| **subagent-driven-development** | Same session: parallelize independent plan items via subagents. |
| **test-driven-development** | Red/green/refactor before implementation. |
| **systematic-debugging** | Structured debugging before guessing fixes. |
| **verification-before-completion** | Run checks and show evidence before claiming “done.” |
| **requesting-code-review** / **receiving-code-review** | How to ask for review and how to handle feedback rigorously. |
| **finishing-a-development-branch** | After tests pass: merge / PR / cleanup options. |
| **using-git-worktrees** | Isolated branches/worktrees for feature work. |
| **dispatching-parallel-agents** | When several tasks don’t depend on each other. |
| **writing-skills** | Author or edit skills themselves. |

## Subagents

- **code-reviewer** — For a meaningful chunk of work, run a dedicated review pass against the plan and standards (you or the agent can invoke it when appropriate).

## Slash commands

Invoked as **`/command`** in the chat:

- **`/brainstorm`** — Same idea as the brainstorming skill: requirements and design before building.
- **`/write-plan`** — Produce a detailed implementation plan with small tasks.
- **`/execute-plan`** — Execute a plan in batches with checkpoints.

## Hooks

- **SessionStart** — On session start, Cursor can inject context (e.g. the “use superpowers / check skills first” reminder) so the model doesn’t skip the workflow skills by default.

## How you actually use it day to day

1. **Describe the goal** — The agent should match a skill (debug, plan, TDD, verify, etc.).
2. **Prefer commands when you want the ritual** — e.g. **`/brainstorm`** then **`/write-plan`** for a non-trivial feature.
3. **Trust automatic use** — For bugs, “it’s fixed,” or multi-step specs, the bundled rules push the model toward the matching skill without you naming it every time.

**Rules** in your project (if configured) reinforce the same behaviors; **hooks** prime new sessions. Together: **skills = playbooks**, **commands = explicit triggers**, **subagents = heavier parallel or review tasks**.

---

**User**

/brainstorming Target: Build an unified SDK. It should contain these tracking behavior user ( Snowplow ), a web push notification ( OneSignal ),a in-house gamification marketing and a in-house sdk to identify end user.

Note:in the future, it may plug-in new sdk. And i do not want the consumer need to intergrate again

---

**Cursor**

Using the brainstorming skill: exploring the project, then we'll refine the design one question at a time. No implementation until you approve the design.



## Project context

`cexp-hub-sdk` is effectively **greenfield**: no application code yet, **no git commits**, only `.cursor/` (and git metadata). So we are designing the SDK from scratch with no existing patterns to match.

## Goal (as stated)

A **unified SDK** that bundles:

- **Analytics / tracking** — Snowplow  
- **Web push** — OneSignal  
- **In-house gamification / marketing**  
- **In-house user identification**  

…and stays **extensible**: new third-party or in-house capabilities later **without consumers redoing a full integration** each time.

---

**Question 1 (pick one):** Which **primary surfaces** must the first version support?

**A)** Browser / web app only (JavaScript/TypeScript)  
**B)** Web + React Native (or similar cross-platform mobile)  
**C)** Web + native iOS + native Android (separate SDKs or shared core)  
**D)** Something else (briefly describe)

Your answer drives how we shape the facade, optional plugins, and dependency boundaries (Snowplow and OneSignal differ a lot by platform).

---

**User**

A) Browser / web app only (JavaScript/TypeScript)

---

**Cursor**

Next I’ll refine the “consumer integration” surface, since it determines the SDK facade and how much automation we can safely provide.  
Question 2 will be about whether page views are auto-captured or must be triggered by the consumer.Given you chose **A) Browser / web app only**, here’s the next integration-critical decision:

**Question 2 (pick one):** For SPA navigation/page views, should the SDK **auto-capture** when the URL changes, or **require the consumer** to explicitly call page tracking?

**A)** Auto-capture `page_view` on URL/route changes (with a small router integration hook)  
**B)** No auto-capture; consumer calls explicit methods like `sdk.trackPageView()`  
**C)** Both: auto-capture optional via config flag

---

**User**

give me all question then i will answer at once

---

**Cursor**

I can’t bundle “all questions at once” here because the brainstorming workflow requires **one question per message** so we don’t lock in assumptions too early. We’ll go step-by-step.

**Question 2 (pick one):** For SPA navigation/page views, should the SDK **auto-capture** when the URL/route changes, or require an explicit call?

A) Auto-capture `page_view` on URL/route changes (router integration hook)  
B) No auto-capture; consumer calls `sdk.trackPageView()` explicitly  
C) Both: auto-capture optional via config flag

---

**User**

Auto-capture page_view on URL/route changes (router integration hook)

---

**Cursor**

Next I’ll keep walking the “clarifying questions” phase (one at a time) so we can design a stable consumer-facing init/config API.

**Question 3 (pick one):** How do you want the consumer to **initialize** the SDK (provide config / keys / endpoints) and at what point?

A) Consumer calls an explicit `init(config)` at app bootstrap (recommended for clarity and control)  
B) SDK auto-initializes from a `window.__CEXP_SDK_CONFIG__` (or script-tag-injected config)  
C) Both: auto-init if config is present, otherwise consumer calls `init(config)`

Reply with `A`, `B`, or `C`.

---

**User**

C

---

**Cursor**

Good — next I’ll pin down the “identify end user” flow, because it affects how Snowplow + OneSignal + gamification stay consistent (anonymous vs known user, timing, and replay rules).**Question 4 (pick one):** When the consumer knows the end-user identity (e.g., after login), how should the SDK support switching from **anonymous** to **known**?

A) SDK always starts anonymous, and consumer later calls something like `sdk.identifyUser({ userId, ... })` after login  
B) SDK starts known immediately at init (if userId is in config) and never creates an anonymous identity  
C) Both: start anonymous by default, but allow known init too (and later re-identify if it changes)

Reply with `A`, `B`, or `C`.

---

**User**

before i anwser your question. Add more information, the unifed SDK must have the toggle feature on each sdk

---

**Cursor**

Got it: the unified SDK should have **separate toggles per capability** (Snowplow, OneSignal, in-house gamification, and in-house identify).

**Question 4 (toggle semantics, pick one):** Should these toggles be:

A) **Init-time only** (passed in config to `init()`); after init they only no-op for disabled parts  
B) Allow **runtime toggling** (e.g. `sdk.setEnabled('snowplow', false)`)  
C) Both (init-time defaults, but runtime can override)

Reply with `A`, `B`, or `C`.

---

**User**

i can not choose which options, but my expected is bussiness user will control on/off on my website

---

**Cursor**

Understood: you want the **website/business logic** to control which parts are enabled/disabled.

**Question 4 (reframed, yes/no):** Can those toggle values change **after the page has loaded** (without a full refresh)?

- **Yes** = we need runtime toggling (SDK must react to updates)
- **No** = we can rely on init-time config toggles only

---

**User**

yes

---

**Cursor**

Next I’ll lock down the core consumer API for sending events and identity updates, since that’s what the “separate toggles” will drive internally.**Question 5 (pick one):** What should the consumer-facing “track event” API look like?

A) A single generic API like `sdk.track(eventName, payload, context?)` and the SDK routes/normalizes to Snowplow + in-house systems  
B) Consumers call Snowplow-like methods specifically (e.g. `sdk.trackSnowplow(...)`) and in-house separately  
C) Both: `sdk.track(...)` as the primary unified API, plus advanced component-specific APIs

Reply with `A`, `B`, or `C`.

---

**User**

A

---

**Cursor**

Next I’ll define the unified event contract, because it determines how Snowplow, gamification, and identify share the same identifiers and context.

**Question 6 (pick one):** When the consumer calls `sdk.track(...)`, should the SDK automatically enrich events with standard context fields (instead of requiring the consumer to provide them)?

A) Yes: auto-attach things like `timestamp`, `pageUrl`, `referrer`, `userAgent`/`device`, `locale`, and internal identifiers (`anonymousId`, optional `userId` if identified)  
B) No: pass-through only; consumer supplies all fields  
C) Both: minimal by default, with optional “auto enrichment” toggle per capability/config

---

**User**

A

---

**Cursor**

**Question 7 (pick one):** For the SDK’s `anonymousId` (used before/without a known `userId`), where should it be stored so it survives page reloads?

A) `localStorage` (default-friendly; persistent across tabs on same origin)  
B) `sessionStorage` (resets when tab closes)  
C) Cookie (persistent; supports server-side reads if needed)  
D) Something else (describe)

---

**User**

D. I already have something like you asking, access this URL and analyze https://octopus-stream01-cads.fpt.vn/cdp.js  . This will generate a "fpt_uuid" which  i were called a in-house sdk to identify 

---

**Cursor**

I’ll quickly fetch and analyze `cdp.js` to understand exactly how it generates and persists `fpt_uuid` (the in-house anonymous identifier). Then I’ll map that into our unified SDK’s identify/anonymous flow and ask the next single design question.

The fetch wrote the JS content to a temporary file under the Cursor agent workspace; I’ll read that file next to extract the exact `fpt_uuid` persistence behavior.

## What `cdp.js` does (your in-house anonymous identity)
From inspecting [`cdp.js`](https://octopus-stream01-cads.fpt.vn/cdp.js), it creates a persistent anonymous identifier named `fpt_uuid`:

- On first run, if `fpt_uuid` doesn’t exist yet, it generates a UUID (v4) and **stores it** so it survives reloads.
- It also runs a “persistent anonymous sync” mechanism (periodically) by calling an in-house sync endpoint with the `fpt_uuid`.
- When it initializes, it can also read existing cookie-backed identifiers (e.g. partner anonymous/user ids) if present.
- The SDK object it exposes is `window.cdpFpt`, with methods like `setAnonymousId(...)`, `identify(...)`, and tracking methods (`page`, `track`, etc.), which makes it a good “core ID provider” for our unified SDK.

## Question 8 (pick one): How should `fpt_uuid` map into the unified SDK?
Should the unified SDK use `fpt_uuid` as the single canonical `anonymousId`?

A) Yes: `sdk.anonymousId` (and any anonymous id we forward) is always `fpt_uuid` across Snowplow + OneSignal + gamification + identify  
B) No: unified SDK has its own anonymous id; only the in-house identify/gamification uses `fpt_uuid`

---

**User**

A. But,remember this able toggle like i said

---

**Cursor**

Great—so `fpt_uuid` becomes the unified SDK’s canonical anonymous id.

Next I’ll focus on runtime toggles, because they determine whether disabled components should **drop events immediately** or **queue and flush later**.**Question 9 (pick one):** When a specific capability toggle (e.g. Snowplow or OneSignal) is turned **off** at runtime, what should the SDK do with events/operations?

A) **Drop** them immediately (no buffering)  
B) **Queue** them while disabled, then **flush** once re-enabled  
C) Queue only for certain types (you specify which ones)

---

**User**

before i pick one, explain these options

---

**Cursor**

Option meanings for runtime toggles (e.g., Snowplow turned off/on after page load):

**A) Drop immediately (no buffering)**  
When that capability is disabled, calls like `sdk.track(...)`, `sdk.pageView(...)`, or any identify/group calls for that capability become **no-ops**. No memory, no local storage, nothing sent later. This is simplest and avoids sending stale data, but you lose events that happened while disabled.

**B) Queue while disabled, flush when re-enabled**  
When disabled, the SDK stores outgoing events in an internal queue (typically in memory, and optionally persisted). As soon as the toggle is turned back on, the SDK **flushes** the queued events in order. This preserves data continuity, but you must choose policies like max queue size, max age (TTL), and what to do if the user navigates away for a long time.

**C) Queue only for certain types**  
Some event types might be worth queueing, others should be dropped. Common split examples:  
- Queue “analytics” page/track events  
- Drop “push” actions or identification that must reflect *current* user state only  
This gives control but requires us to define rules per capability/event type.

**Question 9 (pick one):** Which behavior do you want: `A`, `B`, or `C`?

---

**User**

C

---

**Cursor**

Option `C` means “some operations are queueable, others are dropped.” To make that precise, I’ll start with the **Snowplow (analytics) side**.

**Question 10 (pick one):** If the **Snowplow toggle** is turned off at runtime, which Snowplow operations should the SDK queue?

A) Queue only `page_view` + `track`; **drop** `identify` / `alias` / group changes  
B) Queue `page_view` + `track` **and** `identify`, but **dedupe** so only the latest identity update is sent when re-enabled  
C) Queue `identify` only; drop `page_view` + `track`

Reply with `A`, `B`, or `C`.

---

**User**

C

---

**Cursor**

Next I’ll continue with the remaining runtime-toggle decisions, one at a time, starting with OneSignal behavior when its toggle is turned off.**Question 11 (OneSignal runtime toggle):** When the OneSignal toggle is turned **off** at runtime, what should happen to the OneSignal “player” association (external user id / tags) that we previously set?

A) Keep whatever association/tags were already set; just stop updating going forward  
B) Clear/unset the association/tags immediately  
C) Queue the “latest” association update and apply when OneSignal is re-enabled

---

**User**

B

---

**Cursor**

If the OneSignal side is cleared when disabled, the next similar decision is the **in-house gamification/marketing** pipeline.

**Question 12 (pick one):** When the in-house gamification/marketing toggle is turned **off** at runtime, what should the SDK do with gamification-related `track(...)` events and marketing triggers?

A) Drop them immediately  
B) Queue them while disabled, then flush when re-enabled  
C) Queue only point/score-affecting events, drop the rest (like impressions/click metadata)

---

**User**

A. below are the in-house gamification script to intergated, by the way
    <script src="https://cdn.jsdelivr.net/npm/cexp-gamification@1.0.1-beta.9/dist/cexp-web-sdk.js"></script>

    <script>
      const sdk = new window.cexp({ apiKey: YOUR_API_KEY });

      sdk.init();
    </script>


---

**Cursor**

When the in-house gamification toggle is turned off at runtime, we’ll **drop gamification-related track/trigger calls immediately** (your `A`).

Also noted: the current gamification consumer integration is script-based via:
```html
<script src="https://cdn.jsdelivr.net/npm/cexp-gamification@1.0.1-beta.9/dist/cexp-web-sdk.js"></script>
<script>
  const sdk = new window.cexp({ apiKey: YOUR_API_KEY });
  sdk.init();
</script>
```
So the unified SDK should hide that from your consumers.

**Question 13 (pick one):** Should the unified SDK load that `cexp-gamification` script:

A) Automatically during `sdk.init()` if gamification toggle is enabled  
B) Lazily only when gamification is toggled on at runtime  
C) Always load during `sdk.init()` but stop using it when toggled off (drop events)

---

**User**

A. My idea, the unfied sdk will comunicate with my system through a json file. It will decide which on on/off sdk 

---

**Cursor**

I’ve captured the new requirement: instead of consumers flipping toggles manually, the unified SDK should consult an in-house “JSON control file” and enable/disable Snowplow/OneSignal/gamification/identify based on that. Next I’ll clarify how that JSON is fetched and refreshed (because it affects caching, timing, and which events get queued/dropped).Got it: consumers should not manually integrate toggles; the unified SDK reads your **JSON config/control file** and decides which sub-sdks are on/off.

**Question 14 (pick one):** Where does the SDK get that control JSON from?

A) Consumer passes a `controlJsonUrl` (or similar) in `sdk.init(...)`  
B) Consumer passes the JSON content directly in `sdk.init({ controlJson: ... })`  
C) The SDK has a known, fixed control URL endpoint (no consumer input)  
D) Something else (briefly describe)

---

**User**

C

---

**Cursor**

Cool—so the control JSON is fetched from a **fixed SDK-known endpoint** (no consumer-supplied URL).

**Question 15:** How should the SDK refresh that control JSON while the page is open?

A) Fetch once during `sdk.init()`; never update until full refresh  
B) Poll periodically (every N seconds) and update toggles live  
C) Poll periodically but use cache validators (e.g., `ETag`/`If-Modified-Since`) to reduce network calls

Reply with `A`, `B`, or `C` (and if you choose `B`, tell me the polling interval in seconds).

---

**User**

C

---

**Cursor**

Next I’ll pin down the refresh cadence for the fixed control JSON.

**Question 16:** If we “poll with cache validators” (your `C`), what polling interval should we use (pick one)?

A) 30 seconds  
B) 60 seconds  
C) 5 minutes  
D) 15 minutes

---

**User**

C

---

**Cursor**

Polling interval locked in: you chose **C = 5 minutes** refresh cadence for the control JSON.

**Question 17 (pick one):** Where should the unified SDK store the canonical `anonymousId` (`fpt_uuid`) so it persists across page reloads?

A) `localStorage`  
B) `sessionStorage`  
C) Cookie (persistent)  
D) Both (`localStorage` + cookie fallback)

---

**User**

D

---

**Cursor**

Before we move to “approaches + design”, we still need to lock the unified **identify contract** (what the consumer sends after login / when user info becomes known).

**Question 18:** When the consumer wants to identify the end user, what is the minimum payload the SDK should accept?

A) Only `userId` (string)  
B) `userId` + optional `email` (string) + optional `name` (string)  
C) `userId` + a generic `traits` object (any fields), and the SDK maps/forwards what it can

Reply with `A`, `B`, or `C`.

---

**User**

C

---

**Cursor**

**Question 19:** When the consumer wants to “log out” (revert to anonymous / clear known identity), should the unified SDK expose an explicit method?

A) No; consumer never reverts to anonymous (identity only changes forward)  
B) Yes: `sdk.logout()` (clears `userId` and reverts to anonymous identity)  
C) Yes: `sdk.reset()` (clears identity and any cached traits), but anonymous id remains `fpt_uuid`

Reply with `A`, `B`, or `C`.

---

**User**

C

---

**Cursor**

Plan mode: I’m going to quickly inspect the in-house gamification JS from the CDN to understand the consumer API we need to wrap (identify/track methods). Then, if we still lack the control-JSON schema, I’ll ask for one concrete example.

**Unified SDK control JSON**

> **Do you have an example of the control JSON payload returned by the fixed SDK endpoint (you can redact secrets/keys), so we can match the toggle field names exactly?**
> - Yes — share example JSON (with toggle fields)
> - No — only describe the fields/toggles we should support
> - No — we need to agree on a new control JSON schema ✔

**SDK initialization input**

> **If the unified SDK reads a fixed control JSON endpoint and you’re willing to agree on a new schema, what should the consumer provide to `sdk.init(...)` so the server-side can know which tenant/site config to return?**
> - Nothing (endpoint infers tenant from domain/origin) — init has no required args ✔
> - A single `apiKey` passed to init (e.g., your gamification constructor’s apiKey) — {apiKey}
> - A `clientId`/`appId` passed to init (separate from apiKey) — {clientId}
> - Something else (describe)

---

**User**

continnue planning

---

**Cursor**


Continuing the plan: consolidating requirements and resolving one open design point — whether the fixed control JSON carries only toggles or also per-integration configuration (affects security and consumer surface).



**Control JSON contents**

> **Besides on/off toggles, should the fixed control JSON also carry per-integration configuration (e.g., Snowplow collector URL, OneSignal app id, gamification client/api key), or should those secrets/config values remain only in consumer init / build-time env?**
> - Toggles only — integration configs come from consumer init (or env) and never from the JSON ✔
> - Toggles + non-secret routing/config (URLs, feature flags) — secrets still from init/env
> - Toggles + full per-integration config in JSON (including keys if needed)


Control JSON will carry **toggles only**; Snowplow/OneSignal/gamification keys and endpoints stay in **consumer init** (or build-time env). Here’s the consolidated plan you can accept or refine.

---

## Unified browser SDK — plan

### Goals
- Single **TypeScript** entry for web apps: one dependency, one `init`, unified `track` / `identify` / `page` / `reset`.
- **Plugins** for Snowplow, OneSignal, in-house identity (`cdp.js` / `fpt_uuid`), and gamification (`cexp-web-sdk.js`), so new vendors are added **inside this package** without consumers changing integration shape.
- **Remote toggles** from a **fixed** control endpoint: JSON decides which subsystems are on/off; refresh every **5 minutes** using **conditional requests** (`ETag` / `If-Modified-Since`).
- **Canonical anonymous id**: `fpt_uuid` everywhere when identity subsystem is on; persist via **localStorage + cookie fallback** (your choice D).
- **SPA**: auto `page_view` on route changes via a **history hook** (wrap `history.pushState` / `replaceState` + `popstate`).

### Non-goals (v1)
- Native mobile SDKs.
- Server-side Node SDK.

### High-level architecture

```mermaid
flowchart LR
  subgraph app [Host app]
    Consumer[Consumer code]
  end
  subgraph hub [CexpHubSdk]
    Facade[Facade API]
    Control[ControlFetcher]
    Router[SpaPageView]
    Identity[IdentityService]
    Enrich[Context enrichment]
    Bus[Event bus / router]
    Plugins[Plugin registry]
  end
  subgraph remote [Remote]
    CtrlEP[Fixed control JSON endpoint]
    CDP[cdp.js / fpt_uuid]
    SP[Snowplow]
    OS[OneSignal]
    Gam[cexp-gamification]
  end
  Consumer --> Facade
  Facade --> Control
  Control -->|GET + validators| CtrlEP
  Facade --> Identity
  Identity --> CDP
  Facade --> Router
  Facade --> Bus
  Bus --> Plugins
  Plugins --> SP
  Plugins --> OS
  Plugins --> Gam
```

### Public API (consumer-facing)
- **`init(config?)`**: merge `window.__CEXP_HUB_CONFIG__` if present; load control JSON; start poller; init enabled plugins; wire SPA page views if configured.
- **`track(name, props?)`**: enrich + dispatch to plugins per toggles and per-plugin rules.
- **`page(name?, props?)`** or auto-only: confirm naming in implementation; default is auto + optional manual.
- **`identify(userId, traits?)`**: traits object (your C).
- **`reset()`**: clear known user + traits; **keep** `fpt_uuid` (your C).
- **`setToggles?`**: optional escape hatch for tests; production path is control JSON only (you can omit from public docs if you want strict remote-only).

### Control JSON (new schema — toggles only)
You chose **no example yet** — define a minimal versioned contract, e.g.:

```json
{
  "version": 1,
  "integrations": {
    "snowplow": { "enabled": true },
    "onesignal": { "enabled": false },
    "gamification": { "enabled": true },
    "identity": { "enabled": true }
  }
}
```

- **Semantics**: unknown keys ignored; missing integration → treat as **disabled** or **default true** (pick one and document; recommendation: **default false** for safety).
- **Fetcher**: `GET` fixed URL; store `ETag` / `Last-Modified`; retry with backoff on failure; **do not** flip toggles on transient errors (keep last good state).

### Plugin contract (extensibility)
- Each plugin implements: `name`, `init(ctx)`, `destroy?`, `onToggle(enabled)`, handlers for `track`, `page`, `identify`, `reset`.
- **Hub** owns: enrichment, `fpt_uuid`, control state, and **routing rules** (queue/drop per event type).
- **New vendor** = new plugin file + register in hub; **consumers** keep the same `init` / `track` / `identify`.

### Per-integration behavior (locked from your answers)

| Area | Behavior |
|------|----------|
| **Snowplow** off | **Queue `identify` only**; **drop** `page_view` and `track` until re-enabled |
| **OneSignal** off | **Clear** external user association / tags immediately (your B) |
| **Gamification** off | **Drop** gamification-related traffic immediately (your A); script still loaded on init when gamification enabled at startup (your A for load) — if control turns gamification off at runtime, **stop calling** into SDK and optionally **hide** UI if the gamification lib supports it (verify in implementation) |
| **Identity** | `fpt_uuid` canonical; `localStorage` + cookie fallback |

### Identity & `cdp.js`
- Load [`cdp.js`](https://octopus-stream01-cads.fpt.vn/cdp.js) when **identity** plugin is enabled (or always if identity is core — prefer **lazy load** when identity toggle on to avoid extra JS when off).
- Read/sync `fpt_uuid` from the same mechanism as today; hub exposes `getAnonymousId()` for debugging.

### Gamification (`cexp-gamification`)
- When gamification enabled: load `https://cdn.jsdelivr.net/npm/cexp-gamification@1.0.1-beta.9/dist/cexp-web-sdk.js` (pin version in hub config; bump via releases).
- Wrap `new window.cexp({ apiKey })` + `init()` inside plugin; **apiKey** from consumer `init`, not from control JSON.

### Snowplow
- Use official browser tracker; map unified events + enriched context to Snowplow events; respect Snowplow toggle + queue rules for identify.

### OneSignal
- Initialize only when toggle on; on toggle off run **logout/clear** path per OneSignal web API; on toggle on re-init as needed.

### SPA `page_view`
- Patch `history.pushState` / `replaceState` and listen to `popstate`; debounce; emit `page` through hub with enriched URL/title.

### Repo / deliverables (greenfield)
- TypeScript package (e.g. `packages/cexp-hub-sdk` or root `src/`), build with **rollup** or **tsup**, publish as `@scope/cexp-hub-sdk`.
- `README`: single script tag or npm import, `init` example, control endpoint note, plugin list.
- Tests: unit tests for toggle routing, queue behavior for Snowplow identify, control fetch parsing.

### Risks / follow-ups
- **Fixed control URL**: placeholder constant + env override for staging (document only; you provide final URL).
- **Gamification bundle** is obfuscated — integration may be **best-effort** via documented global; verify methods after load.
- **Consent / GDPR**: not specified — add optional hook later if required.

### Implementation phases
1. Core: facade, enrichment, control fetcher + poller, toggle state machine.
2. Identity plugin (`cdp.js` + storage).
3. Snowplow plugin + identify queue rule.
4. OneSignal plugin + clear-on-disable.
5. Gamification plugin (script loader + wrapper).
6. SPA page view module.
7. Docs, examples, versioning.

---

If this matches what you want, say **execute the plan** (or list changes, e.g. default for missing toggles, exact `page` API name). I’ll treat further tweaks as **plan iteration** until you explicitly ask to implement.

---

**User**


To clarify my expected output.Reanalyze the plan and make sure my requirement
1. Consumer and end user are seperate object. Consumer who person will intergrate this sdk. My idea, they just paste few line and a id to my backend identify who
example: 

`<head>
<script src="https://cdn.jsdelivr.net/npm/cexp-hub/v1`"></script>
window.CExP.init({id:${sdkId}})
</head>`

2.Those method,function should not use direct from the plugin instead there must wrap under CExP sdk

example:
DO THIS
`<head>
window.CExP.init({id:${sdkId}})
const hub = CExP.track()
</head>`

NOT THIS
`<head>
window.CExP.init({id:${sdkId}})
const hub = Snowplow.track()
</head>`

---

**Cursor**


Here’s a **reanalyzed plan** that matches your clarified requirements. This is **plan iteration only** (no implementation).

---

## 1. Consumer vs end user (your requirement)

| Role | Who | Role in the design |
|------|-----|---------------------|
| **Consumer** | Developer / site owner who pastes the snippet | Identified by **`sdkId`** (and only that in the minimal snippet). They never call Snowplow/OneSignal/gamification globals directly. |
| **End user** | Visitor in the browser | Gets **`fpt_uuid`** (and later `userId` + traits after login) **inside** the hub; plugins use those identities, but the host page does not integrate each vendor separately. |

**Minimal integration (your target):**

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/cexp-hub@1/dist/cexp-hub.min.js"></script>
  <script>
    window.CExP.init({ id: 'YOUR_SDK_ID' });
  </script>
</head>
```

- **`id` / `sdkId`**: the only consumer-supplied identifier; it tells **your backend** which tenant/site/integration this is.
- **Plan change vs earlier draft**: we no longer rely on the consumer passing Snowplow URLs, OneSignal keys, gamification `apiKey`, etc. Those must be **resolved server-side** using `sdkId` (e.g. second request: `GET .../config?sdkId=...` or embedded in the first control JSON response). Your earlier choice “control JSON = toggles only” can stay **if** a separate **config-by-sdkId** response supplies non-secret routing (collector host, OneSignal app id, gamification client id). If you want a **single** remote file, extend that contract to include **resolved integration config keyed by `sdkId`** (still no secrets in HTML).

---

## 2. Single public surface: `CExP` only (your requirement)

- **Do**: `window.CExP.init(...)`, `window.CExP.track(...)`, `window.CExP.identify(...)`, `window.CExP.reset(...)`, etc.
- **Don’t**: `Snowplow.*`, `OneSignal.*`, `window.cexp(...)`, `cdpFpt.*` in consumer code.

**Implementation rule:** Snowplow, OneSignal, `cdp.js`, and `cexp-gamification` are **internal modules/plugins**. They are **not** re-exported on `window` for consumers. Optional: expose `CExP.__internals` only in debug builds — not in docs.

**Note on your example:** you wrote `const hub = CExP.track()`. Treat **`track` as a method** with arguments, e.g. `CExP.track('event_name', { ... })`, not a factory that returns `hub`. If you want a **chainable** object, we can document `const hub = CExP` and `hub.track(...)` — same rule: only under `CExP` / `hub` from `CExP`, never vendor globals.

---

## 3. How this fits the rest of the plan

| Topic | Adjustment |
|--------|--------------|
| **Init** | `CExP.init({ id })` loads hub, then hub fetches **remote config + toggles** using `sdkId` (exact URL scheme TBD: fixed base URL + `sdkId` query or path). |
| **Control JSON** | Either merged with **config-by-sdkId** in one response, or two calls (toggles + config); consumer still only passes `id`. |
| **Toggles** | Still driven by your backend JSON; polling every 5 min with cache validators unchanged. |
| **Plugins** | Unchanged internally; **not** part of the public API. |
| **End-user identity** | Still `fpt_uuid` + `identify(userId, traits)` via **`CExP.identify`** only. |

---

## 4. Gaps to lock before implementation (one decision)

You need a single rule: **where does `sdkId` resolve Snowplow/OneSignal/gamification parameters?**

- **A)** One backend response: `{ toggles, integrations: { snowplow: {...}, onesignal: {...}, gamification: {...} } }` keyed by `sdkId`  
- **B)** Two endpoints: toggles (fixed) + `GET /sdk-config?id=...`  
- **C)** Something else  

If you don’t answer now, the plan can default to **A** (one round-trip after `init`).

---

**Summary:** The plan is updated so that **consumers are identified only by `sdkId` in `CExP.init({ id })`**, and **all behavior is exposed only as `window.CExP.*`**, with vendors fully wrapped. Say if you want **A/B/C** for config resolution; otherwise we’ll treat **A** as the default when you ask to execute the plan.

---

**User**

/brainstorming  create implementation plan and save it. Do not implement

---

**Cursor**


Following the brainstorming → writing-plans flow: reading the writing-plans skill, then creating and saving an implementation plan document (no code).




Using the writing-plans skill to create the implementation plan. Creating `docs/superpowers/plans/` and saving the plan document.




I’m using the **writing-plans** skill to produce this deliverable.

## Done

- **Implementation plan saved:** [`docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md`](docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md)  
- **Committed:** `docs: add CExP Hub SDK implementation plan` (root commit)

The plan includes:

- **Consumer vs end user**: `sdkId` only in `CExP.init({ id })`; `fpt_uuid` + `identify`/`reset` for end users.  
- **Public API**: only `window.CExP.*` — no direct Snowplow / OneSignal / vendor globals in the integration story.  
- **File layout**, **toggle / queue rules**, **control service** (5m poll + ETag), and **bite-sized tasks** with test/commit steps.  
- **No application code** — documentation and task breakdown only.

**Note:** The brainstorming skill’s full pipeline also expects a **design spec** under `docs/superpowers/specs/…` and a **spec review** loop before implementation. You asked only for a saved implementation plan; that spec file was not created. Say if you want that spec added next.

---

**Execution handoff** (when you choose to implement):

1. **Subagent-driven** — use `subagent-driven-development` task-by-task.  
2. **Inline** — use `executing-plans` with checkpoints.

Which do you want when you’re ready to build (not required now)?

---

**User**

what are purpose of Task 6 and Task 8 ?

---

**Cursor**


Here’s what those tasks are for in the plan:

### Task 6: Context enrichment
**Purpose:** Build a single place (`ContextEnricher`) that **adds standard context** to every event the consumer sends, so they don’t have to pass URL, path, referrer, locale, user agent, timestamps, etc. themselves.

From the plan ([`docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md`](docs/superpowers/plans/2026-03-20-cexp-hub-sdk.md)) it should merge things like `pageUrl`, `path`, `referrer`, `locale`, `userAgent`, `timestamp` into the payload, with a clear rule so **explicit user fields win** over auto-filled ones.

**Why it matters:** Your requirement was a unified `CExP.track(...)` API with consistent, rich events across Snowplow / in-house systems without repeating boilerplate in every app.

---

### Task 8: SPA auto page view
**Purpose:** Implement **automatic `page_view` (or internal `page`) when the URL changes** in single-page apps, without the consumer calling `CExP.page()` on every route change.

The plan does this by **hooking `history.pushState` / `replaceState` and `popstate`**, debouncing briefly, then calling the hub’s internal `page()` with enriched path/title.

**Why it matters:** That matches your earlier decision to auto-capture page views on route changes; without this, SPAs would only get the first load unless every app manually tracks navigation.

