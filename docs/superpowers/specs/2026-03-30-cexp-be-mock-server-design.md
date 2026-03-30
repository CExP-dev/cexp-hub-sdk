# `cexp-be` mock server — control config endpoint

**Status:** Draft for review

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
- Simulating Snowplow / OneSignal / identity (`cdp.js`) / gamification (`cexp-gamification`) vendor behavior.
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
      "snowplow": { "enabled": <boolean> },
      "onesignal": { "enabled": <boolean> },
      "gamification": { "enabled": <boolean>, "packageVersion"?: <string>, "apiKey"?: <string> },
      "identity": { "enabled": <boolean> }
    }
  }
  ```

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
The file contains exactly the `ControlConfig` JSON object (no wrappers):
```json
{
  "version": 1,
  "integrations": {
    "snowplow": { "enabled": false },
    "onesignal": { "enabled": false },
    "gamification": {
      "enabled": true,
      "packageVersion": "1.0.1-beta.10",
      "apiKey": "k_123"
    },
    "identity": { "enabled": false }
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
- `integrations` as an object with the four known integration blocks (if missing, the server may fill defaults with `enabled: false`)
- `enabled` as boolean
- for `gamification`:
  - `apiKey` is optional (if present but empty/invalid, it can be omitted from the server response)
  - `packageVersion` is optional (if present but invalid/unallowlisted/too long, it can be omitted from the server response)

---

## ETag generation rules
To ensure the SDK’s polling detects changes correctly:
- The server computes the `ETag` from the exact JSON response string that it would send on a `200`.
- ETag MUST change when any relevant field changes (including `gamification.packageVersion` / `gamification.apiKey`).
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
  - `apiKey` and `packageVersion` are optional inputs; if they are invalid, `tryParseControlConfig()` sanitizes them (treating them as absent) rather than failing the whole parse
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
    - toggling `gamification.enabled` or `gamification.packageVersion/apiKey` causes `onUpdate` to fire (polling change detection)

---

## Open questions
None.

---

## Approval
Ready for reviewer approval before implementation.

