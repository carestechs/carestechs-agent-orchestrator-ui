# Implementation Plan: T-005 — BFF `/api/v1/*` JSON pass-through with bearer injection

## Task Reference
- **Task ID:** T-005
- **Type:** Backend
- **Workflow:** standard
- **Complexity:** M
- **Rationale:** Single chokepoint guarantees the API key never reaches the browser and that error envelopes stay RFC 7807-compliant per `docs/api-spec.md`.

## Overview
Add a generic forwarder under `/api/v1/*` that requires a valid session, opens a Node-native `fetch` to `${ORCHESTRATOR_BASE_URL}/v1/*`, injects `Authorization: Bearer ${ORCHESTRATOR_API_KEY}`, and passes status, headers, and bodies (including `application/problem+json`) through unchanged. Handles upstream connection failures and 5xx responses with the BFF-specific problem codes from `docs/api-spec.md > Error Catalog`.

## Implementation Steps

### Step 1: Extend the BFF config loader with orchestrator env vars
**File:** `bff/src/config.ts`
**Action:** Modify
Add `ORCHESTRATOR_BASE_URL` and `ORCHESTRATOR_API_KEY` to `BffConfig` and the loader in T-004. In production, fail fast on boot if either is missing. **Never** log either value (per `CLAUDE.md > BFF (Node) > Never log the orchestrator API key` and AC-5). Allow a dev-only `.env`-driven default; the loader logs only `apiKeyConfigured: true|false` as a boolean.

### Step 2: Implement the orchestrator client (fetch wrapper)
**File:** `bff/src/upstream/orchestrator-client.ts`
**Action:** Create
Named exports:
- `forwardJson(req: { method: string; path: string; query: URLSearchParams; headers: IncomingHeaders; body: Readable | Buffer | null }, config: BffConfig): Promise<UpstreamResponse>`.
- The function:
  - Builds the URL as `${config.orchestratorBaseUrl}/v1${path}?<query>` where `path` is the part after `/api/v1`.
  - Strips hop-by-hop request headers before forwarding: `host`, `connection`, `transfer-encoding`, `content-length`, `keep-alive`, `proxy-authorization`, `te`, `trailer`, `upgrade` — and the inbound `Authorization` and `Cookie` (the browser cookie is BFF-only). Per the Technical Note: "Strip `host`, `connection`, `transfer-encoding` from forwarded request headers".
  - Adds `Authorization: Bearer ${config.orchestratorApiKey}` — the only place this header is set.
  - Uses Node's native `fetch` (no `node-fetch`, no `axios`, no library that auto-decompresses — required by Technical Note: "Do not use libraries that auto-decompress (it complicates streaming in T-006)").
  - Returns `{ status: number; headers: Headers; body: ReadableStream | null }` so callers can pipe or buffer.
- A private `redactHeaders(h)` helper exists to scrub `authorization` and `cookie` from any debug/log output. Authorization is added at this layer and never logged.

### Step 3: Implement the generic JSON forwarder route
**File:** `bff/src/routes/api-proxy.ts`
**Action:** Create
- Register `ALL /api/v1/*` (Fastify wildcard or Express `app.all('/api/v1/*', ...)`); apply the `requireSession` preHandler from T-004 first.
- On unauthenticated → 401 problem+json with `code: 'unauthenticated'` is emitted by `requireSession` (no upstream call), satisfying AC-1.
- On authenticated:
  - Capture the wildcard segment (the path after `/api/v1`, including leading `/`).
  - Convert `request.query` to `URLSearchParams`.
  - Stream the inbound request body through to `forwardJson` as a `Readable` for non-GET/HEAD; GET/HEAD pass `null`.
  - On the upstream `Response`:
    - Copy the upstream `status`, all headers EXCEPT hop-by-hop (`transfer-encoding`, `connection`, `keep-alive`) and `content-encoding` (we never advertise compression — keeps T-006 streaming-safe).
    - For this JSON forwarder, buffer the response body and write it back; pass through `application/problem+json` unchanged with its original status and `code` field intact (AC-3). Do **not** transform.
  - On `fetch` rejection (DNS/ECONNREFUSED/etc.) → respond `500 application/problem+json` with `{ type, title: 'Upstream unavailable', status: 500, code: 'upstream-unavailable' }` (per `docs/api-spec.md > Error Catalog` and AC-4).
  - On upstream `status >= 500` and `< 600` (and `Content-Type` not `application/problem+json`) → respond `502 application/problem+json` with `{ code: 'upstream-error', status: 502, ... }` (AC-4). If the upstream already emitted `application/problem+json`, pass it through unchanged (AC-3).
- **Important:** the `/api/v1/runs/:id/trace` route gets a dedicated streaming handler in T-006; the generic forwarder must **not** match that path. Either register the trace route first (route precedence) or add an explicit exclusion (`if (path.endsWith('/trace')) return next()`).

### Step 4: Wire the proxy into the BFF bootstrap
**File:** `bff/src/server.ts`
**Action:** Modify
- Register the api-proxy routes after the auth routes.
- Ensure body parsing is configured to allow JSON through transparently. For Fastify, set `addContentTypeParser('*', { parseAs: 'buffer' }, ...)` or use `request.raw` in the proxy handler so we don't double-parse and re-serialize JSON (preserves byte identity for AC-2). For Express, use `express.raw({ type: '*/*' })` on the `/api/v1/*` route only.

### Step 5: Unit tests for the orchestrator client and proxy
**File:** `bff/src/upstream/orchestrator-client.spec.ts`
**Action:** Create
Vitest specs (mock `fetch` via `vi.stubGlobal` or MSW-node):
- Authenticated request reaches upstream with `Authorization: Bearer <key>` (assert key value matches the test config).
- Inbound `Authorization` and `Cookie` headers from the SPA are stripped — never forwarded upstream.
- Hop-by-hop headers (`host`, `connection`, `transfer-encoding`) are stripped.
- Upstream 200 with `{ data, meta }` is returned byte-identical (AC-2): hash compare on the body.
- Upstream 409/404/422 with `application/problem+json` body is returned with original status and the `code` field intact (AC-3).
- Upstream connect failure (`fetch` throws `TypeError`/`ECONNREFUSED`) → response is `500` problem+json with `code: 'upstream-unavailable'` (AC-4).
- Upstream 500/503 with non-problem body → response is `502` problem+json with `code: 'upstream-error'` (AC-4).
- Logger spy: assert no log entry contains the literal value of `ORCHESTRATOR_API_KEY` or the string `Authorization` followed by `Bearer` (AC-5).

### Step 6: Integration spec for the proxy route
**File:** `bff/src/routes/api-proxy.spec.ts` (optional companion to Step 5)
**Action:** Create
End-to-end test that boots a Fastify/Express instance with a mocked upstream and asserts:
- Unauthenticated request to `/api/v1/runs` returns `401 problem+json` with `code: 'unauthenticated'` and the upstream mock was **never** invoked (AC-1).
- Authenticated request to `/api/v1/runs?status=paused&page=1&pageSize=20` reaches the upstream URL `${ORCHESTRATOR_BASE_URL}/v1/runs?status=paused&page=1&pageSize=20`.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `bff/src/config.ts` | Modify | Add `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY` with prod fail-fast; never log values. |
| `bff/src/upstream/orchestrator-client.ts` | Create | `forwardJson` wrapper around native `fetch`; bearer injection; hop-by-hop strip; redaction helper. |
| `bff/src/upstream/orchestrator-client.spec.ts` | Create | Unit coverage for header injection, hop-by-hop strip, 5xx mapping, log redaction. |
| `bff/src/routes/api-proxy.ts` | Create | `requireSession`-gated wildcard `/api/v1/*` JSON forwarder. |
| `bff/src/routes/api-proxy.spec.ts` | Create | Integration test: unauth blocked without upstream call; happy path forwards correctly. |
| `bff/src/server.ts` | Modify | Register raw body parser and the api-proxy routes; ensure trace route from T-006 has precedence. |

## Edge Cases & Risks
- **Body re-serialization breaks byte identity:** if Fastify's default JSON parser intercepts the body and we then `JSON.stringify` to forward, whitespace/key order may change — this is rare for upstream-generated JSON but we sidestep it entirely by using `parseAs: 'buffer'` on `/api/v1/*`.
- **`Content-Length` mismatch when stripping `Content-Encoding`:** if upstream sends gzipped bodies and we don't decompress, we must keep `Content-Encoding` paired with the encoded body. Safer: send `Accept-Encoding: identity` upstream so we never receive compressed bodies (also helps T-006). Add this to `forwardJson`.
- **Wildcard route collision with the trace stream (T-006):** explicitly skip `*/trace` in the generic handler, or rely on registration order. Document the chosen mechanism in `bff/src/server.ts`.
- **Inbound `Authorization` header injection attempt:** stripping it (Step 2) prevents a malicious client from overriding the BFF's bearer with their own.
- **Logging:** if Fastify's default request logger is enabled, configure it to redact `req.headers.authorization`, `req.headers.cookie`, and `res.headers['set-cookie']`. The default logger configuration must explicitly opt into this.
- **`ORCHESTRATOR_API_KEY` in error stacks:** never include the URL with the bearer (the bearer is a header, not a query) — but assert in tests that `error.message` contains neither the key nor the literal string `Authorization`.

## Acceptance Verification
- [ ] **AC-1** (Unauthenticated → 401 problem+json, no upstream call): `api-proxy.spec.ts` boots the server, hits `/api/v1/runs` without a cookie, asserts `Content-Type: application/problem+json`, body `code: 'unauthenticated'`, and the upstream mock was never invoked.
- [ ] **AC-2** (Authenticated `GET /api/v1/runs` byte-identical to upstream): `orchestrator-client.spec.ts` compares the proxied response body to the upstream fixture (e.g., SHA-256) and confirms identity, modulo hop-by-hop headers.
- [ ] **AC-3** (`409`/`404`/`422` problem+json passes through with `code` intact): three parameterized tests assert each status round-trips, including the exact `code` literal.
- [ ] **AC-4** (Connect failure → 500 `upstream-unavailable`; upstream 5xx → 502 `upstream-error`): two tests in `orchestrator-client.spec.ts` cover each error class.
- [ ] **AC-5** (Logs never contain the API key or `Authorization` header): a logger spy collects all entries during the test run and `expect(logs).not.toMatch(<KEY>)` and `not.toMatch(/Authorization:\s*Bearer/)`.
