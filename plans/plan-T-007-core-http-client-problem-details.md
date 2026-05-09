# Implementation Plan: T-007 — Core HTTP client + ProblemDetails error mapping

## Task Reference
- **Task ID:** T-007
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** Centralizes the boundary parsing rule from `CLAUDE.md` ("Boundary types") and ensures every feature service gets typed errors with a `code` field — required by the error toast logic and by the auth guard's 401 interception (T-008).

## Overview
Wrap Angular's `HttpClient` in a single `ApiClient` core service that adds `withCredentials: true` (so the BFF session cookie is sent on every call), unwraps the standard `{ data, meta }` envelope returned by the BFF, and converts non-2xx `application/problem+json` bodies into a typed `ProblemDetailsError`. Expose a global signal that fires when the server returns `401 unauthenticated`, so the auth guard / `AuthService` (T-008) can react without each service repeating that logic.

This service is the single chokepoint for every JSON call from the SPA — per `CLAUDE.md` "One service per resource", feature services in T-009 will consume `ApiClient`, never `HttpClient` directly.

## Implementation Steps

### Step 1: Confirm `ProblemDetails` model exists (T-003)
**File:** `src/app/models/api.model.ts`
**Action:** Modify (verify only)
Confirm `ProblemDetails` and `Pagination` interfaces are exported from T-003 with the shape defined in `docs/data-model.md` § "ProblemDetails": `{ type, title, status, detail?, instance?, code, errors? }`. If T-003 used a different filename (`problem-details.ts`), keep the existing path — do NOT rename. This step is verification only; no edit unless the file is missing the `code` field.

### Step 2: Create the typed error class
**File:** `src/app/core/problem-details.error.ts`
**Action:** Create
Create a `ProblemDetailsError` class extending `Error` that wraps a `ProblemDetails`:
- Constructor accepts `(problem: ProblemDetails)`, sets `this.message = problem.title`, exposes `status`, `code`, `title`, `detail`, `errors` as readonly fields off `problem`.
- Static helper `ProblemDetailsError.fromUnknown(status: number, body: unknown): ProblemDetailsError` — narrows `body` from `unknown`, falling back to a synthesized `ProblemDetails` (`{ type: 'about:blank', title: 'Unexpected error', status, code: 'unknown' }`) when the body is not a parseable problem document. This satisfies the "malformed-JSON fallback" AC.
- Use **named export only** per `CLAUDE.md` Naming Conventions ("Named exports only").

### Step 3: Create the global auth-expired signal source
**File:** `src/app/core/auth-events.ts`
**Action:** Create
Define a small standalone signal source decoupled from `AuthService` to avoid a circular dependency between `ApiClient` and `AuthService`:
- `export const authExpired = signal<number>(0);` — a monotonic counter; bump it whenever a `401 unauthenticated` is observed. The auth guard subscribes via `effect()` (T-008).
- Export a function `notifyAuthExpired(): void` that increments the counter. Keep this file dependency-free (no Angular DI) so `ApiClient` can call it without circular imports.

This realizes the AC "401 unauthenticated errors emit a global signal the auth guard can react to" using `signal()` per `CLAUDE.md` "Signals for component state" (here, application state).

### Step 4: Implement `ApiClient`
**File:** `src/app/core/api-client.ts`
**Action:** Create
Create an `@Injectable({ providedIn: 'root' })` class `ApiClient` that delegates to `HttpClient` (per `CLAUDE.md` "Patterns to Follow" — `HttpClient` is reserved for JSON; raw `fetch` only for the trace stream in T-010).

API surface (all methods accept an absolute path starting with `/api/v1` or `/auth`, e.g. `'/api/v1/runs'`):

```ts
get<T>(path: string, params?: Record<string, string | number | undefined>): Observable<{ data: T; meta: unknown }>;
post<T>(path: string, body: unknown): Observable<{ data: T; meta: unknown }>;
delete<T>(path: string): Observable<{ data: T; meta: unknown }>;
```

Implementation rules:
- Always pass `{ withCredentials: true, observe: 'response', responseType: 'json' }` so the session cookie is included and so error bodies are accessible.
- Build `HttpParams` from the `params` map, filtering out `undefined` values.
- Use `map()` to unwrap `{ data, meta }`: callers receive an object with `data: T` and a separate `meta` field (per AC "surface meta separately").
- Use `catchError()` to handle `HttpErrorResponse`:
  - If `error.headers.get('content-type')?.includes('application/problem+json')` and `error.error` is an object with a `code` string, build a `ProblemDetailsError` directly.
  - Otherwise, call `ProblemDetailsError.fromUnknown(error.status, error.error)` — covers the "malformed-JSON fallback" AC.
  - If the resulting error has `code === 'unauthenticated'` (or `status === 401` and the path is not `/auth/me`/`/auth/login`), call `notifyAuthExpired()` before rethrowing. Skipping `/auth/me` prevents the bootstrap "are you logged in?" probe from triggering an expiry redirect.
  - Rethrow via `throwError(() => problemError)`.
- RxJS is the right primitive here: `CLAUDE.md` allows it for `HttpClient`. Components will bridge via `toSignal()` per "Signals for component state".

No default export — named export `ApiClient` only.

### Step 5: Unit tests
**File:** `src/app/core/api-client.spec.ts`
**Action:** Create
Vitest spec using `HttpTestingController` (via `provideHttpClientTesting()` and `provideHttpClient()` with fetch backend disabled) to cover:
- 200 envelope unwrap: `GET /api/v1/runs` returns `{ data: [...], meta: { page: 1, ... } }` and `ApiClient.get` resolves to `{ data, meta }` with the inner array on `data`.
- 409 problem+json parsing: simulate `application/problem+json` body `{ code: 'run-already-terminal', title: 'Run already terminal', status: 409, type: '...' }`; assert the rejection is a `ProblemDetailsError` with `code === 'run-already-terminal'` and `status === 409`.
- 401 → `authExpired` signal increments exactly once.
- 401 from `/auth/me` does NOT increment `authExpired` (bootstrap probe must not loop).
- Malformed JSON / empty body on 500: rejection is a `ProblemDetailsError` with `code === 'unknown'` and `status === 500`.
- `withCredentials: true` is set on every request (assert via `HttpTestingController` request matcher).

Co-locate per `CLAUDE.md` Testing Conventions ("Test location: Co-located"). Filename `*.spec.ts`.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/models/api.model.ts` | Verify | Confirm `ProblemDetails` from T-003 has `code` field. |
| `src/app/core/problem-details.error.ts` | Create | Typed error class wrapping `ProblemDetails` + `fromUnknown` fallback. |
| `src/app/core/auth-events.ts` | Create | Global `authExpired` signal + `notifyAuthExpired()`; no Angular DI to avoid cycles. |
| `src/app/core/api-client.ts` | Create | `HttpClient` wrapper: credentials, envelope unwrap, problem+json mapping, 401 emission. |
| `src/app/core/api-client.spec.ts` | Create | Vitest unit tests covering all four ACs. |

## Edge Cases & Risks
- **Circular dependency `ApiClient` ↔ `AuthService`.** Resolved by putting the auth-expired signal in `auth-events.ts` (no DI) so `ApiClient` need not import `AuthService`.
- **Bootstrap `/auth/me` 401 must not be treated as expiry.** Without the path-skip in Step 4, the very first `auth/me` probe would redirect already-loggedout users to `/login?reason=expired` instead of plain `/login`. Path skip handles this; covered by spec.
- **`POST /auth/logout` returns 204 with no body** — `delete<T>` / generic post must tolerate empty `204` bodies (envelope unwrap should yield `{ data: undefined as unknown as T, meta: null }`). Either special-case 204 or document that callers handle `undefined` data.
- **Future SSR.** `withCredentials: true` is harmless under SSR but `HttpTestingController` use here is browser-only; spec runs in jsdom.
- **Error envelope drift.** `docs/api-spec.md` says BFF passes orchestrator errors through unchanged. If the BFF ever wraps them, the parser breaks silently. Mitigation: the malformed-JSON fallback ensures something usable still surfaces; the fallback `code: 'unknown'` makes drift visible in toasts.

## Acceptance Verification
- [ ] AC "get/post/delete return typed T (data) and surface meta separately" — covered by signature in Step 4 and the 200-unwrap spec case in Step 5.
- [ ] AC "Non-2xx responses throw a ProblemDetailsError carrying status, code, title, detail" — covered by the 409 problem+json spec case.
- [ ] AC "401 unauthenticated emits a global signal the auth guard can react to" — covered by the `authExpired` increment spec case.
- [ ] AC "Unit tests cover 200 envelope unwrap, 409 problem+json parsing, malformed-JSON fallback" — all three explicit cases in Step 5.
- [ ] Convention check: no NgModules, named exports only, `HttpClient` (not `fetch`) — verified by code review against `CLAUDE.md` "Code Style & Conventions".
