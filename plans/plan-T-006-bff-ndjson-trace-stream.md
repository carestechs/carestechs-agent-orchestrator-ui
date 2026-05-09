# Implementation Plan: T-006 — BFF NDJSON streaming pass-through for `/api/v1/runs/:id/trace`

## Task Reference
- **Task ID:** T-006
- **Type:** Backend
- **Workflow:** standard
- **Complexity:** M
- **Rationale:** The trace is the live signal-arrival channel; any buffering kills the AC "trace begins streaming within 1s" and breaks `meta.alreadyReceived` detection. Identified as a risk in the feature brief.

## Overview
Add a dedicated route at `GET /api/v1/runs/:id/trace` that opens an upstream `fetch` (with `follow`, `since`, `kind` query forwarded), then pipes the response body straight to the client using Node's `pipeline()` — no buffering, no JSON parsing, no compression in the middle. The route must beat the generic `/api/v1/*` forwarder from T-005 in registration order so the streaming handler wins. Per `CLAUDE.md > Patterns to Follow > Trace consumption via ReadableStream` and `Anti-Patterns to Avoid > No WebSockets / SSE for the trace`.

## Implementation Steps

### Step 1: Extend the orchestrator client with `streamTrace`
**File:** `bff/src/upstream/orchestrator-client.ts`
**Action:** Modify
Add a named export:
- `streamTrace(runId: string, query: URLSearchParams, signal: AbortSignal, config: BffConfig): Promise<Response>` — opens a Node native `fetch` to `${config.orchestratorBaseUrl}/v1/runs/${encodeURIComponent(runId)}/trace?<query>`, with:
  - `Authorization: Bearer ${config.orchestratorApiKey}` (single chokepoint, never logged — per `CLAUDE.md > BFF (Node) > Never log the orchestrator API key`).
  - `Accept: application/x-ndjson`.
  - `Accept-Encoding: identity` — disables compression on the upstream leg so the body stays line-by-line readable (Technical Note: "Do not use libraries that auto-decompress").
  - `signal` — wired to an `AbortController` controlled by the route handler so a client disconnect aborts the upstream fetch (AC-3).
- Returns the raw `Response` so the route handler can inspect status/headers and pipe the body.
- Use Node native `fetch` only — required by AC-2 and the Technical Note. Do not introduce `node-fetch`/`undici` wrappers that could buffer.

### Step 2: Implement the trace route handler
**File:** `bff/src/routes/trace.ts`
**Action:** Create
Register `GET /api/v1/runs/:id/trace` and apply the `requireSession` preHandler from T-004.

Handler steps in order:
1. Build query allowlist: forward only `follow`, `since`, and (multi-valued) `kind` from `request.query` into a fresh `URLSearchParams`. Drop unknown params to avoid leaking SPA-internal state upstream.
2. Construct an `AbortController`. Bind:
   - `request.raw.on('close', () => controller.abort())` (Express) or `request.raw.on('aborted', …)` plus `reply.raw.on('close', …)` (Fastify) — required by AC-3 to abort the upstream fetch on client disconnect.
3. Call `streamTrace(runId, query, controller.signal, config)`.
4. On the upstream `Response`:
   - If `status === 401` → respond `401 application/problem+json` with `code: 'unauthenticated'` immediately, **without** consuming the body (AC-4: propagates without buffering).
   - If `status === 404` (`run-not-found`) → pass through the upstream problem+json body unchanged (it's small, read once and forward).
   - If `status >= 500` → respond `502 application/problem+json` with `code: 'upstream-error'` (consistent with T-005).
   - If `status === 200`:
     - Set response headers BEFORE writing any body bytes:
       - `Content-Type: application/x-ndjson` (AC-1).
       - `Transfer-Encoding: chunked` (AC-1) — most frameworks set this implicitly when there is no `Content-Length`; assert it explicitly by **not** setting `Content-Length`.
       - `Cache-Control: no-store, no-transform`.
       - `X-Accel-Buffering: no` — required by AC-5 / Technical Note: "Disable any reverse-proxy buffering downstream via `X-Accel-Buffering: no`".
       - **Do not** set `Content-Encoding`. If the upstream response carries `Content-Encoding` (it shouldn't, because we sent `Accept-Encoding: identity`), drop it before forwarding (AC-5).
     - Flush headers immediately so the SPA's `fetch` resolves and starts reading the body without waiting for the first chunk. For Fastify: `reply.raw.flushHeaders()`. For Express: `res.flushHeaders()`.
     - Pipe the upstream body to the response using Node's `stream/promises` `pipeline()`:
       ```ts
       import { pipeline } from 'node:stream/promises';
       import { Readable } from 'node:stream';
       const upstreamNode = Readable.fromWeb(upstream.body as ReadableStream);
       await pipeline(upstreamNode, reply.raw); // Fastify
       // or:  await pipeline(upstreamNode, res); // Express
       ```
       Per Technical Note: "Use `pipeline(upstream.body, reply.raw)` (Fastify) or `upstream.body.pipe(res)` (Express); flush headers immediately." `pipeline()` is preferred over raw `.pipe()` because it propagates errors and abort signals correctly to both ends.
5. On any thrown error (e.g., upstream `fetch` rejected with `AbortError` because the client closed):
   - If headers are already sent, just end the response (the client is gone).
   - If headers are not yet sent and the error is a connect failure → respond `500 upstream-unavailable` problem+json (consistent with T-005).
6. **Never** call `JSON.parse` on the body, never `await response.text()`, never accumulate chunks — required to satisfy AC-2 (lines arrive incrementally).

### Step 3: Register the trace route before the wildcard forwarder
**File:** `bff/src/server.ts`
**Action:** Modify
- Register the auth routes from T-004.
- Register the trace route from this task **before** the `/api/v1/*` wildcard from T-005, so route precedence ensures the streaming handler wins.
- Disable any global response compression plugin (e.g., `@fastify/compress`, `compression` middleware) on `/api/v1/runs/:id/trace`. The simplest path is to not register compression at all for v1 — `CLAUDE.md > Patterns to Follow > Trace consumption via ReadableStream` plus AC-5 require no compression on this endpoint.

### Step 4: Co-located integration test for streaming and disconnect
**File:** `bff/src/routes/trace.spec.ts`
**Action:** Create
Use Vitest with a `vi.stubGlobal('fetch', …)` mock (or MSW-node) that yields chunks with controllable delays. Tests:
- **Headers (AC-1):** boot the BFF, hit `/api/v1/runs/abc/trace?follow=true` with a valid session cookie, mock upstream returns a `ReadableStream` that emits two NDJSON lines with a 200ms gap. Assert response headers `Content-Type: application/x-ndjson`, `Transfer-Encoding: chunked`, `X-Accel-Buffering: no`, no `Content-Encoding`, no `Content-Length`.
- **Incremental delivery (AC-2):** read the response body via `fetch().body.getReader()`; record the timestamp of the first emitted line. Assert it arrives within 500ms of the request start while the upstream mock holds the second line for 2s. This proves no buffering.
- **Client abort (AC-3):** abort the consumer's `AbortController` mid-stream; spy on the upstream fetch's `AbortController` (passed via `signal`) and assert it received `abort` within 100ms.
- **Upstream 401 propagation (AC-4):** mock upstream returns `401 application/problem+json` `{ code: 'unauthenticated' }`. Assert the BFF response is `401 application/problem+json` with the same `code`, and that the BFF did not stream any bytes (the response was emitted from buffered headers + small body, not from the streaming pipe).
- **No `Content-Encoding` (AC-5):** mock upstream attempts `Content-Encoding: gzip`; assert the BFF response strips it. (Belt-and-braces — `Accept-Encoding: identity` should prevent this from happening upstream.)
- **No log of the API key:** spy the logger; assert no log line contains the configured `ORCHESTRATOR_API_KEY` value or the string `Bearer`.

### Step 5: Document streaming guarantees and ingress expectations
**File:** `bff/src/routes/trace.ts`
**Action:** Modify
Add a top-of-file JSDoc block:
- "This route MUST NOT be wrapped in any compression or response-buffering middleware. Any reverse proxy in front of the BFF must honor `X-Accel-Buffering: no` (nginx) or its equivalent (Cloudflare: `Cache-Control: no-transform`)."
- "Per CLAUDE.md > Patterns to Follow > Trace consumption via ReadableStream and Anti-Patterns to Avoid > No WebSockets / SSE for the trace, the only transport is NDJSON over HTTP."
This is the file the next maintainer reads first; keep the constraints in-source.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `bff/src/upstream/orchestrator-client.ts` | Modify | Add `streamTrace(runId, query, signal, config)` using native `fetch` with `Accept-Encoding: identity`. |
| `bff/src/routes/trace.ts` | Create | `GET /api/v1/runs/:id/trace` handler: session-gated, `pipeline()` pass-through, `X-Accel-Buffering: no`, no compression, `AbortController` on disconnect. |
| `bff/src/routes/trace.spec.ts` | Create | Integration tests for streaming headers, sub-500ms first-line delivery, client abort propagation, upstream 401 pass-through, no `Content-Encoding`. |
| `bff/src/server.ts` | Modify | Register the trace route BEFORE the `/api/v1/*` wildcard; do not register response-compression on `/api/v1/*`. |

## Edge Cases & Risks
- **Framework auto-buffering on `reply.raw`:** Fastify will not buffer if you write directly to `reply.raw` and end via `pipeline`. Express's `res` is fine for `.pipe()` but `pipeline()` is preferred for error propagation. Either way, do not call `reply.send(...)` after starting the pipe — that double-ends the response.
- **Upstream emits a final partial line without `\n`:** the BFF doesn't care (it pipes bytes); the SPA's parser in T-010 must handle a trailing buffer at stream end.
- **Reverse-proxy buffering downstream of the BFF:** `X-Accel-Buffering: no` covers nginx (and most ingresses derived from it). Cloudflare needs `Cache-Control: no-transform` — already set above. Document this in the JSDoc.
- **Client disconnect race:** if the client closes before headers are sent, we may set headers on a closed socket. Guard with `if (!reply.raw.headersSent && !reply.raw.writableEnded)`. The error handler in Step 2.5 covers the late case.
- **AbortController not honored by Node `fetch` for the body stream:** Node 20+ propagates `signal` into the body's underlying socket; verify in the test by asserting the upstream socket closes within 100ms of `controller.abort()`.
- **Compression plugin added later:** if `@fastify/compress` (or `compression`) is registered globally in a future task, it MUST exclude this route — add a unit test that fails if the response carries `Content-Encoding`.
- **Session expiry mid-stream (feature brief Risks):** when the orchestrator returns a mid-stream connection-level error, the BFF closes the response; the SPA's `TraceStreamService` (T-010) sees the close and reconnects with `since=`. This task does not need to re-validate session per chunk — the cookie is checked once on connect by `requireSession`.

## Acceptance Verification
- [ ] **AC-1** (`Content-Type: application/x-ndjson` and `Transfer-Encoding: chunked`): `trace.spec.ts` "Headers" test asserts both headers (and the absence of `Content-Length` and `Content-Encoding`).
- [ ] **AC-2** (Lines arrive incrementally; first line in <500ms while upstream stalls between lines): `trace.spec.ts` "Incremental delivery" test reads from `response.body.getReader()` and asserts the first chunk's timestamp is within 500ms while the second is held for 2s upstream.
- [ ] **AC-3** (Client disconnect aborts upstream fetch via `AbortController`): "Client abort" test wires a spy onto the upstream `AbortController.signal`, aborts the consumer, asserts upstream `signal.aborted === true` within 100ms.
- [ ] **AC-4** (Upstream `401` propagates as `401 unauthenticated` without buffering): "Upstream 401 propagation" test asserts the BFF emits `401 application/problem+json` with `code: 'unauthenticated'` and no stream pipe was opened (the upstream body was a small problem+json buffer, not piped).
- [ ] **AC-5** (No `Content-Encoding: gzip|br` on the response; upstream encoding decoded or disabled): "No Content-Encoding" test asserts the response header is absent even when the upstream mock attempts to set it; the upstream request carries `Accept-Encoding: identity` (asserted in Step 1's coverage of `streamTrace`).
