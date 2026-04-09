# `cexp-be` mock server — control config endpoint

> **Partially superseded (2026-04):** This spec describes the **legacy** `{ version: number, integrations }` wire format. The SDK now expects the **unified** `{ version: string, sdkId?, modules[] }` shape — see [2026-04-09-unified-control-config-design.md](./2026-04-09-unified-control-config-design.md). The `cexp-be` mock server should be updated to emit the unified format.

**Status:** Implemented in [`cexp-be`](../../../../cexp-be) (see [`README.md`](../../../../cexp-be/README.md)); keep this spec aligned with code changes.

**Related:** [`cexp-hub-sdk` `ControlService`](../src/hub/ControlService.ts) and [`ControlConfig` schema](../src/config/schema.ts)

---

## Goal
Provide a local “backend” mock (`cexp-be`) that returns the control JSON required by `cexp-hub-sdk` so developers can run integration tests / Node harnesses against the SDK without hitting the production control host.

The mock server MUST:
1. Serve `GET /v1/sdk-config?sdkId=...`
2. Return a `ControlConfig` JSON payload matching the SDK’s parsing expectations
3. Support polling change detection via `ETag` + `If-None-Match` + `304 Not Modified`
4. Support “reload without restart” by reading from a local JSON config file that updates on disk

This spec intentionally scopes to the control endpoint only (no vendor script serving or third-party SDK mocking).

---

## Non-goals
- Simulating OneSignal / gamification (`cexp-gamification`) vendor behavior in depth.
- Serving the SDK bundle (`dist/browser.global.js`).
- Varying toggles by `sdkId` (for now); unknown `sdkId` returns the same config payload.

---

## Control endpoint contract

### Route
- `GET /v1/sdk-config?sdkId=<string>`

### Response: `200 OK`
When config is available and the request does not match the current `ETag`, respond with:
- Status: `200`
- Headers:
  - `content-type: application/json`
  - `etag: <current-etag>`
  - (optional) `cache-control: no-store`
- If the request does not include `If-None-Match`, treat it as a mismatch and respond with `200`.
- Body: a single JSON object shaped as `ControlConfig`:
  ```json
  {
    "version": <number>,
    "integrations": {
      "notification": { "enabled": <boolean>, "appId"?: <string> },
      "gamification": {
        "enabled": <boolean>,
        "packageVersion"?: <string>,
        "clientKey"?: <string>,
        "tokenBaseUrl"?: <string>
      }
    }
  }
  ```
  Optional gamification fields follow the same rules as `tryParseControlConfig()` (see [2026-03-30-version-management-design.md](./2026-03-30-version-management-design.md), section **Gamification CDP access token**).

### Response: `304 Not Modified`
If the request header `If-None-Match` equals the current `ETag`:
- Status: `304`
- Headers:
  - `etag: <current-etag>`
- No response body.

### Unknown `sdkId`
- The mock ignores `sdkId` and returns the same config for any value.

---

## Config file contract (reloadable, single ControlConfig object)

### Location
The server reads a single JSON file from disk. The server should support configuring the path via:
- environment variable `CEFX_MOCK_CONFIG_PATH` (suggested name)

### Shape
The file contains exactly the `ControlConfig` JSON object (no wrappers). The **`cexp-be` mock** does not read or emit legacy **`apiKey`**; use **`clientKey`** + **`tokenBaseUrl`** for the CDP JWT flow (same allowlisting as hub `safeTokenBaseUrl`), or only **`enabled`** / **`packageVersion`** as needed. Production control APIs may still return `apiKey` for the real SDK.

Example (CDP fields):
```json
{
  "version": 1,
  "integrations": {
    "notification": { "enabled": false },
    "gamification": {
      "enabled": true,
      "packageVersion": "1.0.1-beta.10",
      "clientKey": "ck_example",
      "tokenBaseUrl": "https://staging-cexp.cads.live/gamification"
    }
  }
}
```

### Reload without restart
Implementation should:
1. Load the file on startup
2. Watch the file for changes (fs-watch or a lightweight watcher)
3. On change:
   - re-read and re-parse the JSON
   - if parsing succeeds, replace the in-memory active config snapshot atomically
   - if parsing fails, keep the last known-good config (do not crash)

The snapshot MUST include both:
- the exact response body serialization (string/bytes), and
- the derived `etag` string,

so each request reads a single consistent `(etag, body)` pair.

### Validation expectations (align with SDK)
The server SHOULD validate the config file to fail fast (optional), but it MUST NOT emit payloads that violate SDK parsing invariants.

For `gamification` remote knobs, remember that `tryParseControlConfig()` sanitizes invalid optional fields instead of failing parsing. The mock server may:
- omit optional fields when the config file provides invalid/empty values, or
- return them and rely on the SDK sanitization.

In practice, the file should always include:
- `version` as a finite number
- `integrations` as an object with the **two** known integration blocks (`notification`, `gamification`; if missing, the server may fill defaults with `enabled: false`)
- `enabled` as boolean
- for `gamification`:
  - `packageVersion` is optional (if invalid/unallowlisted/too long, omit)
  - `clientKey` is optional (non-empty trimmed string, else omit)
  - `tokenBaseUrl` is optional (`https` on allowlisted host, `/gamification` path prefix; else omit — same as hub `safeTokenBaseUrl`)

---

## ETag generation rules
To ensure the SDK’s polling detects changes correctly:
- The server computes the `ETag` from the exact JSON response string that it would send on a `200`.
- ETag MUST change when any relevant field changes (including `gamification.packageVersion`, `gamification.clientKey`, `gamification.tokenBaseUrl`; production payloads may also include `gamification.apiKey`, which this mock does not emit).
- The mock MUST treat the incoming/outgoing `ETag` values as opaque strings:
  - The `etag` response header value is compared byte-for-byte to the raw `If-None-Match` header value from the request.
  - ETag formatting (including quoting) is not normalized.

Implementation guidance:
- Derive `etag` as a stable hash of the response body.
- Prefer canonicalizing the response string (e.g. stable stringify) so key ordering changes in the config file do not accidentally alter ETag semantics.
- The server MUST return as the HTTP response body the exact same serialized string/bytes used to compute the `etag`.

## SDK-parsing alignment (what must be true for `200`)
`cexp-hub-sdk` applies `tryParseControlConfig()` to decide whether to accept a control payload. Therefore, the server MUST ensure that every `200` response body is strict-parseable by `tryParseControlConfig()`:
- the top-level JSON value is a plain object
- `integrations` is a plain object
- each integration block present in the response is a plain object
- each integration block’s `enabled` value is a JSON boolean
- for `gamification`:
  - `packageVersion`, `clientKey`, and `tokenBaseUrl` are optional; invalid values are omitted by `tryParseControlConfig()` rather than failing the whole parse
  - the only hard structural requirements are `gamification` being a plain object and `gamification.enabled` being a boolean

To avoid ETag/body changes that don’t translate into SDK state changes, the server SHOULD compute the response JSON (and ETag) from the normalized/sanitized values it plans to return (i.e., omit optional gamification fields when they are invalid/empty).

---

## Operational behavior

### Content type
- Always send `content-type: application/json` for `200` responses.

### Error handling
- If the config file cannot be parsed at startup and no last-known-good config exists:
  - respond with an all-disabled fallback config for `200` responses (`version: 0`, all `enabled: false`)
  - still compute an `etag` for that fallback and continue to support `304`
- For transient parse errors after startup:
  - keep last-known-good config

---

## Local development usage
Example manual verification:
1. Start server with `CEFX_MOCK_CONFIG_PATH=/path/to/config.json`
2. In a separate terminal:
   - `curl -i "http://localhost:<port>/v1/sdk-config?sdkId=test-sdk"`
   - capture the `etag` header value
   - repeat with `-H "If-None-Match: <etag>"`
3. Edit the config file on disk, confirm:
   - a subsequent request returns `200` with the updated `etag`

---

## Testing plan (expected)
- Unit-style tests (server integration):
  - 200 response returns valid `ControlConfig` for the SDK
  - ETag + 304 behavior works (no body on 304)
  - reload without restart updates response
- SDK-side tests (recommended):
  - Create a small harness that points `ControlService({ controlUrl: mockServerUrl, ... })` at this server and verifies that:
    - toggling `gamification.enabled` or `gamification.packageVersion` / `clientKey` / `tokenBaseUrl` causes `onUpdate` to fire (polling change detection; `apiKey` only applies to production-shaped configs, not this mock)

---

## Open questions
None.

---

## Approval
Initial design approved; ongoing changes should stay consistent with `cexp-be` and `cexp-hub-sdk` `tryParseControlConfig()`.

