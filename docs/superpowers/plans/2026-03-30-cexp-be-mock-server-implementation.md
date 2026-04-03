# `cexp-be` Mock Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Goal:** Create a local `cexp-be` mock server that serves the control endpoint `GET /v1/sdk-config?sdkId=...` for `cexp-hub-sdk`, including `ETag`/`If-None-Match` + `304` and reload-without-restart from a JSON file.

**Architecture:** Use Node.js + Express. A config loader reads and sanitizes a local JSON file into a “response snapshot” (serialized JSON + derived ETag). The HTTP handler serves from the snapshot, and the loader updates the snapshot when the config file changes (fs watcher).

**Tech Stack:** Node.js, Express, Vitest, Supertest, `fs.watch`, `crypto` (sha256). Implementation in TypeScript.

---

## Task 1: Scaffold `cexp-be` project + baseline endpoint (fallback config)

**Files:**
- Create: `/home/long/hub/cexp-be/package.json`
- Create: `/home/long/hub/cexp-be/tsconfig.json`
- Create: `/home/long/hub/cexp-be/src/createApp.ts`
- Create: `/home/long/hub/cexp-be/src/types.ts`
- Create: `/home/long/hub/cexp-be/src/configSnapshot.ts`
- Create: `/home/long/hub/cexp-be/test/control-endpoint.fallback.test.ts`

Assume the server supports:
- `CEFX_MOCK_CONFIG_PATH` env var for the JSON config file path
- If unset or file missing/invalid at startup: serve fallback `version: 0` and all integrations `{ enabled: false }`.

- [ ] **Step 1: Write the failing test**

Create `test/control-endpoint.fallback.test.ts` with assertions:
1. `GET /v1/sdk-config?sdkId=anything` returns `200`
2. `content-type` contains `application/json`
3. Body matches the `ControlConfig` shape:
   - `version` is `0` (fallback)
   - `integrations.onesignal.enabled` and `integrations.gamification.enabled` are both `false`
4. Response includes an `etag` header (non-empty string)

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/long/hub/cexp-be && npm test
```
Expected: FAIL (server project not scaffolded / route missing).

- [ ] **Step 3: Implement the minimal code to make the test pass**

Implement:
1. `src/createApp.ts` that creates an Express app with the `GET /v1/sdk-config` route
2. A simple in-memory fallback snapshot in `src/configSnapshot.ts`:
   - `ControlConfig` fallback object
   - stable JSON serialization
   - derived ETag computed from the serialized JSON
3. The route logic:
   - read `If-None-Match` request header:
     - if it exists and equals snapshot etag -> return `304` with `etag` header and no JSON body
     - otherwise -> return `200` with `etag` header and JSON body
   - ignore `sdkId` for now

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /home/long/hub/cexp-be && npm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/long/hub/cexp-be && git init || true
git add .
git commit -m "feat: scaffold cexp-be mock server with fallback control endpoint"
```

---

## Task 2: Implement config file loading + reload without restart

**Files:**
- Create: `/home/long/hub/cexp-be/src/loadConfigFromFile.ts`
- Create: `/home/long/hub/cexp-be/src/configWatcher.ts`
- Modify: `/home/long/hub/cexp-be/src/createApp.ts`
- Modify: `/home/long/hub/cexp-be/src/configSnapshot.ts`
- Create: `/home/long/hub/cexp-be/test/control-endpoint.reload.test.ts`

- [ ] **Step 1: Write the failing test**

In `test/control-endpoint.reload.test.ts`:
1. Create a temporary JSON file on disk with a valid config.
2. Start the app with `process.env.CEFX_MOCK_CONFIG_PATH` pointing to it.
3. `GET /v1/sdk-config?sdkId=test` returns `200` and body reflects the file config.
4. Capture initial `etag` and body.
5. Update the file contents on disk (e.g., flip `integrations.gamification.enabled` and/or `packageVersion`/`apiKey`).
6. Wait briefly (use a small retry loop) until the next request returns the updated JSON and `etag` differs.

Expected: FAIL (reload logic not implemented yet).

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/long/hub/cexp-be && npm test
```
Expected: FAIL.

- [ ] **Step 3: Implement minimal code**

Implement:
1. `loadConfigFromFile.ts`:
   - reads file contents
   - parses JSON
   - validates/normalizes to ensure the server NEVER emits a payload that fails the SDK’s `tryParseControlConfig()` invariants:
     - parsed JSON must be a non-null plain object (reject arrays/primitives)
     - `version` must be a finite number (otherwise treat reload as failure)
     - `integrations` must be a plain object (otherwise treat reload as failure)
     - unknown integration keys must be ignored; emitted response must include only:
       - `onesignal`, `gamification`
     - for each integration key:
       - if the block is missing: treat as disabled (`enabled: false`)
       - if present: must be a plain object
       - `enabled` must be a JSON boolean (otherwise treat reload as failure)
     - for `gamification` only:
       - `apiKey`: include only if it is a string whose trimmed value is non-empty; otherwise omit
       - `packageVersion`: include only if it matches regex `^[0-9A-Za-z][0-9A-Za-z+._-]*$` and length <= `128`; otherwise omit
2. `configWatcher.ts`:
   - initial load into an in-memory snapshot
   - uses `fs.watch` to detect changes
   - debounces file changes (e.g. 100-250ms)
   - on valid reload: atomically swap the snapshot used by the handler
   - on reload failure (JSON parse error and/or invariant validation failure): keep last-known-good snapshot
3. Wire the watcher into `createApp.ts` so request handlers read from the latest snapshot (atomic reference swap).

Reload semantics:
- Each request must observe a consistent `(etag, responseBody)` pair from the same snapshot.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /home/long/hub/cexp-be && npm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/long/hub/cexp-be
git add .
git commit -m "feat: add reloadable control config watcher with snapshot swap"
```

---

## Task 3: Verify ETag + 304 correctness

**Files:**
- Create: `/home/long/hub/cexp-be/test/control-endpoint.etag-304.test.ts`
- Modify: `/home/long/hub/cexp-be/src/createApp.ts` (only if needed)

- [ ] **Step 1: Write the failing test**

In `etag-304` test:
1. Start server with config file.
2. Perform a `GET` and capture `etag1` plus response body `body1`.
3. Perform `GET` again with header `If-None-Match: etag1`.
4. Assert:
   - status is `304`
   - response includes `etag: etag1`
   - response body is empty / undefined (depending on framework; assert no JSON is present)

Also add:
- When `If-None-Match` header is missing: response is `200`.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/long/hub/cexp-be && npm test
```
Expected: FAIL if route logic is incomplete.

- [ ] **Step 3: Implement minimal code**

Ensure:
- The server treats `If-None-Match` as an opaque string token for equality comparison.
- ETag is computed from the exact serialized response JSON used for the HTTP body.

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

## Task 4: Ensure invalid config reload does not break serving

**Files:**
- Create: `/home/long/hub/cexp-be/test/control-endpoint.invalid-reload.test.ts`
- Modify: watcher code if needed

- [ ] **Step 1: Write the failing test**

Test:
1. Start server with valid config.
2. Make a request capture `etagStable` and `bodyStable`.
3. Overwrite config file with invalid JSON (e.g. `{ invalid`).
4. Wait a moment for watcher (use a small retry loop until the request completes).
5. Request again; assert it still returns the old `etagStable` and the exact same response body used in the initial snapshot.

6. Overwrite config file with valid JSON that violates invariants (example: `"version": "1"` or `"enabled": "false"` as a string).
7. Wait a moment for watcher (retry loop).
8. Request again; assert `etagStable` and `bodyStable` are unchanged.

9. Add one more “valid JSON but invalid container shape” overwrite (examples):
   - `"integrations": []` or `"integrations": "nope"`
   - `"gamification": null` or `"gamification": []`
10. Wait a moment for watcher (retry loop).
11. Request again; assert `etagStable` and `bodyStable` are unchanged.

- [ ] **Step 2: Run tests to verify it fails**
- [ ] **Step 3: Implement minimal code**
Implementation: watcher must catch both JSON parse errors and invariant validation failures (including invalid container shapes/types), and keep last-known-good snapshot.
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

## Task 5: Add `cexp-be` documentation + run scripts

**Files:**
- Modify: `/home/long/hub/cexp-be/package.json`
- Create: `/home/long/hub/cexp-be/README.md`

Docs should include:
- how to run with `CEFX_MOCK_CONFIG_PATH`
- example `curl` commands for `200` and `304` flows
- reminder that `sdkId` is ignored (same config for any sdkId) in this mock

- [ ] **Step 1: Write failing test or doc-check step**

If no doc tests exist, use a “manual check” step in the plan.

- [ ] **Step 2: Implement docs**
- [ ] **Step 3: Commit**

---

## Task 6: Integration smoke check with `cexp-hub-sdk` (optional but recommended)

**Files:**
- Create: `/home/long/hub/cexp-be/test/sdk-harness.smoke.test.ts`

Test idea:
- Spin the mock server
- Instantiate `cexp-hub-sdk` `ControlService` in a test harness (Node/jsdom)
- Verify that polling triggers `onUpdate` when `gamification.apiKey` or `packageVersion` changes.

This test may be optional if it’s brittle across environments.

- [ ] **Step 1: Write failing smoke test**
- [ ] **Step 2: Implement minimal harness glue**
- [ ] **Step 3: Run + commit**

