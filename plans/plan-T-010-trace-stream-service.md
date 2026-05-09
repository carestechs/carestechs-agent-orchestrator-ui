# Implementation Plan: T-010 — TraceStreamService: `fetch` + `ReadableStream` to signals

## Task Reference
- **Task ID:** T-010
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** L
- **Rationale:** Pure RxJS doesn't ergonomically read NDJSON; per `CLAUDE.md` "Patterns to Follow" — "Trace consumption via ReadableStream. Use fetch (not HttpClient) for /runs/{id}/trace so we can read the NDJSON stream line-by-line." Also load-bearing for the FEAT-001 AC "trace begins streaming within 1s" and "session expiry mid-stream cleanly redirects".

## Overview
Build `TraceStreamService` — the only place in the SPA that uses raw `fetch`, wrapping a `ReadableStream<Uint8Array>` from `GET /api/v1/runs/:id/trace?follow=true` and bridging the line-by-line NDJSON output into Angular signals. The parser is a pure function (string in, `TraceRecord[]` out) so it can be unit-tested deterministically against synthetic chunk splits. On a transient network drop, the service reconnects exactly once with `since=<lastRecordOccurredAt>` to avoid duplicate records; on `401` it closes and surfaces an auth-expired event the guard (T-008) consumes; on destroy it aborts via `AbortController`.

## Implementation Steps

### Step 1: Pure NDJSON line-splitter
**File:** `src/app/core/ndjson-parser.ts`
**Action:** Create
Pure named-export functions, no Angular DI:

```ts
export interface NdjsonParserState { buffer: string; }
export const createParserState = (): NdjsonParserState => ({ buffer: '' });

/** Push a chunk; return the full lines extracted (excluding trailing partial). */
export function pushChunk(state: NdjsonParserState, chunk: string): string[];

/** Flush any remaining buffered content as a final line (or [] if empty). */
export function flush(state: NdjsonParserState): string[];
```

Behavior:
- `pushChunk` appends `chunk` to `state.buffer`, splits on `\n`, returns all elements except the last (which becomes the new `buffer`). Trims any trailing `\r` for tolerant handling of `\r\n`.
- Empty lines are dropped here (cheaper than re-checking after JSON parse).
- The parser is allocation-light: a single string buffer, no regex.

Per `CLAUDE.md` "Functional composition over classes" — keep this as plain functions. Per AC "Keep the parser pure (string in, TraceRecord[] out) so it's unit-testable without a server."

### Step 2: TraceRecord JSON-decoder
**File:** `src/app/core/ndjson-parser.ts` (same file)
**Action:** Modify (continuation)
Add `parseTraceLine(line: string): TraceRecord | null`:
- `JSON.parse(line)` inside try/catch; on parse failure, `console.warn('[trace] dropped malformed line', line.slice(0, 200))` and return `null` (per `docs/ui-specification.md` § Behavior: Trace Stream — "malformed lines are dropped with a console.warn").
- Validate the discriminator: returned object must have `kind in {'step','executor_call','policy_call','webhook_event','effector_call'}` and a string `recordId`/`occurredAt`. Otherwise return `null`. Returns the value typed as `TraceRecord` (discriminated union from `src/app/models/trace.model.ts`, T-003).
- The validation is a runtime type guard at the wire boundary, satisfying `CLAUDE.md` Patterns "Boundary types — every payload from the BFF is parsed into a typed interface".

### Step 3: Co-located tests for the parser
**File:** `src/app/core/ndjson-parser.spec.ts`
**Action:** Create
Vitest cases — server-free, signal-free:
- Single complete line in one chunk.
- Three lines in one chunk → 3 strings.
- Line split across two chunks (e.g. chunk 1 = `'{"kind":"step","re'`, chunk 2 = `'cordId":"r1",...}\n'`) → first chunk yields `[]`, second yields the joined line. Satisfies AC "Partial-line buffering across chunk boundaries is correct".
- `\r\n` terminator handled.
- Malformed JSON → `parseTraceLine` returns `null` and emits `console.warn`.
- Unknown `kind` → returns `null`.
- `flush()` on a non-terminated trailing line returns it; on empty buffer returns `[]`.

### Step 4: Implement `TraceStreamService`
**File:** `src/app/core/trace-stream.service.ts`
**Action:** Create
`@Injectable({ providedIn: 'root' })` class, named export `TraceStreamService`.

State signals (per `CLAUDE.md` "Signals for component state"):
- `private readonly _records = signal<TraceRecord[]>([]);` — rolling list of every accepted record.
- `readonly records = this._records.asReadonly();`
- `private readonly _status = signal<'idle' | 'connecting' | 'streaming' | 'closed' | 'error'>('idle');`
- `readonly status = this._status.asReadonly();`
- `readonly latestOccurredAt = computed(() => { const r = this._records(); return r.length ? r[r.length - 1].occurredAt : null; });`

Internals:
- `private controller: AbortController | null = null;`
- `private retriesUsed = 0;` — caps reconnect attempts at `MAX_RETRIES = 1` per task description ("reconnect with since=<lastTimestamp> once on transient drop, abort on destroy"). Document `MAX_RETRIES` as a const at the top of the file.

Public API:
```ts
open(runId: string, options?: { kinds?: TraceRecord['kind'][] }): void;
close(): void;
```

`open` behavior:
1. If `controller` is non-null, call `close()` first (idempotent re-open).
2. Reset `_records.set([])`, `_status.set('connecting')`, `retriesUsed = 0`.
3. Build URL: `/api/v1/runs/${encodeURIComponent(runId)}/trace?follow=true`. If reconnecting, append `&since=${encodeURIComponent(latestOccurredAt() ?? '')}`. Append repeated `&kind=...` for each entry in `options.kinds`. Per `docs/api-spec.md` § Trace endpoint.
4. `this.controller = new AbortController();`
5. Start an async `void this.run(url);`.

`run(url)` (private async):
- `const res = await fetch(url, { credentials: 'include', signal: controller.signal });` — `credentials: 'include'` ensures the BFF session cookie travels.
- If `res.status === 401`: `_status.set('error')`, call `notifyAuthExpired()` (from `src/app/core/auth-events.ts`, T-007) so the guard redirects to `/login?reason=expired`, then return. Satisfies AC "On 401, the service stops and emits an auth-expired event consumed by the guard."
- If `!res.ok || !res.body`: bump `_status.set('error')`; if `retriesUsed < MAX_RETRIES`, `retriesUsed++` and re-enter `run` after a 1s delay using `setTimeout` (cleared on `close`); otherwise leave status `error`. Satisfies AC "reconnects with since=<lastRecordTimestamp> once and gives up after N retries with an error signal."
- On 2xx: `_status.set('streaming')`. Pull `const reader = res.body.getReader();`, `const decoder = new TextDecoder();`, `const state = createParserState();`. Loop:
  - `const { done, value } = await reader.read();`
  - If `done`: call `flush(state)` for any trailing line, parse + append, set `_status.set('closed')`. If the run is still expected to be live (i.e., upstream closed before we did) AND `retriesUsed < MAX_RETRIES`, reconnect once with `since=<latestOccurredAt>`.
  - Otherwise: `pushChunk(state, decoder.decode(value, { stream: true }))` → for each line, `parseTraceLine` → if non-null, append via `_records.update(arr => [...arr, rec])`. Use a single `update` per chunk (not per line) to avoid signal-storm re-renders: collect parsed records, then `_records.update(arr => arr.concat(parsed))`.
- Catch `AbortError` separately: `_status.set('closed')`, return without retry (we asked it to stop).
- Other errors → same retry-once-with-since logic as the `!res.ok` branch above.

`close()` behavior:
- `controller?.abort(); controller = null;` (covers AC "On AbortController.abort() the fetch closes and no further records are emitted").
- `_status.set('closed')`.
- Cancel any pending retry `setTimeout`.

Concrete forbidden-pattern guardrail: this file may import `TraceRecord` types and `signal/computed` from `@angular/core` and `notifyAuthExpired` from `auth-events.ts` only. It must NOT import `HttpClient`, `EventSource`, or `WebSocket` — `CLAUDE.md` Anti-Patterns explicitly bans those for the trace.

### Step 5: Service unit tests
**File:** `src/app/core/trace-stream.service.spec.ts`
**Action:** Create
Use a controllable `ReadableStream` fixture. Helper:

```ts
function makeStreamingResponse(): { response: Response; push: (s: string) => void; close: () => void; } { /* ... */ }
```

Mock `globalThis.fetch` to return that `Response`. Vitest cases mapping to ACs:
- **Records appear within 1s.** Push `'{"kind":"step",...}\n'`, then within the test's wait window assert `service.records().length === 1`. (The implementation has no artificial delay; the AC is a non-buffering property — verified by asserting that a single emitted record reaches the signal before any further chunks arrive.)
- **Partial line across chunk boundary.** Push `'{"kind":"step","record'` then `'Id":"r1","stepNumber":1,"occurredAt":"...","runId":"r","nodeName":"n","state":"started"}\n'`. After the first push, `records()` is empty; after the second, it has 1 record.
- **`AbortController.abort()` stops emissions.** After calling `service.close()`, push another line; assert `records()` is unchanged.
- **`since=` on reconnect.** First connection: emit one record then close the stream (simulating transient drop). Assert second `fetch` call was made with `?...&since=<that-record-occurredAt>`. Assert no more than one reconnect.
- **Give up after `MAX_RETRIES`.** Make `fetch` reject twice; assert `_status` ends in `'error'` and `fetch` was called exactly twice.
- **`401` triggers `notifyAuthExpired`.** Mock `fetch` to resolve with `{ status: 401 }`; spy on `auth-events.notifyAuthExpired`; assert called exactly once and stream is closed.

### Step 6: Wire `runDetail` consumers (placeholder)
**File:** *(none — no edits in this task)*
**Action:** None
T-018 will inject `TraceStreamService` into `RunDetailComponent`, call `open(runId)` from a constructor `effect()` keyed off `route.params`, and call `close()` from `ngOnDestroy`. Documented here so the API in Step 4 is complete; no code change in this task.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/core/ndjson-parser.ts` | Create | Pure line-splitter + `parseTraceLine` boundary type guard. |
| `src/app/core/ndjson-parser.spec.ts` | Create | Chunk-boundary, `\r\n`, malformed-line, unknown-kind cases. |
| `src/app/core/trace-stream.service.ts` | Create | `fetch`/`ReadableStream` → signals; abort/reconnect/401 handling. |
| `src/app/core/trace-stream.service.spec.ts` | Create | Streaming, reconnect-with-since, abort, 401 → auth event, retry cap. |

## Edge Cases & Risks
- **Buffering at the ingress.** Per FEAT-001 risks: an nginx/Cloudflare layer that buffers responses defeats the streaming contract. T-006 (BFF) sets `X-Accel-Buffering: no`; this service can't fix infrastructure but can detect it: if `_status` stays `'connecting'` for >5s with no records on a confirmed-live run, expose that to the screen for an inline banner. Out of scope for v1 mechanics — log a `console.warn` only, document for ops follow-up.
- **`TextDecoder` boundary safety.** Always use `decoder.decode(value, { stream: true })` so multibyte UTF-8 sequences aren't mangled at chunk boundaries.
- **Reconnect loop on slow stalled connection.** `MAX_RETRIES = 1` is the contractual cap. If the stream closes cleanly because the run reached terminal status, that's not an error — `flush` collects the tail line and we set `'closed'`. Distinguishing "clean done" from "transient drop" purely from `done = true` is impossible without server hints; reconnecting once with `since=` is harmless because the orchestrator will return zero new records on a terminated run.
- **Record-ordering on reconnect.** `since=<occurredAt>` is exclusive per `docs/api-spec.md`; new records are appended, no de-dup needed. If the orchestrator ever changes that to inclusive, we'd see one duplicate per reconnect — caught by an integration test in T-018 against the same fixture.
- **Memory growth.** `_records` holds the entire trace. For v1 runs (≤200 steps × ~5 records each) this is fine; if traces exceed thousands of records, slice to the last N. Out of scope.
- **`credentials: 'include'` and `withCredentials: true` parity.** `fetch` here uses `credentials: 'include'`; `ApiClient` in T-007 uses `HttpClient`'s `withCredentials: true`. Both ship the BFF session cookie — same effect, two APIs.
- **Anti-pattern compliance.** `CLAUDE.md` says "No WebSockets / SSE for the trace. It is plain NDJSON over HTTP." Step 4's import list is the enforcement.

## Acceptance Verification
- [ ] AC "Records appear in the signal within 1s of upstream emission" — Step 5 first spec case asserts no buffering between chunk and signal write.
- [ ] AC "Partial-line buffering across chunk boundaries is correct" — Step 3 parser spec + Step 5 service-level chunk-split case.
- [ ] AC "On AbortController.abort() the fetch closes and no further records are emitted" — Step 5 abort spec case.
- [ ] AC "On network drop with follow=true, the service reconnects with since=<lastRecordTimestamp> once and gives up after N retries with an error signal" — Step 5 `since=` reconnect case + retry-cap case.
- [ ] AC "On 401, the service stops and emits an auth-expired event consumed by the guard" — Step 5 401 case asserts `notifyAuthExpired` called once and stream closed.
- [ ] Convention check: raw `fetch` only here (no `HttpClient`); no `EventSource`/WebSocket import; signals for state; named exports; pure parser separated from service per `CLAUDE.md` Patterns + Anti-Patterns.
