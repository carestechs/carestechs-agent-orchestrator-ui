# Implementation Plan: T-004 — BFF session middleware and `/auth/*` routes

## Task Reference
- **Task ID:** T-004
- **Type:** Backend
- **Workflow:** standard
- **Complexity:** M
- **Rationale:** The SPA never holds the orchestrator key; the BFF session is the only credential the browser sees. Required by AC "no `Authorization` header in browser network logs".

## Overview
Implement cookie-based session middleware (signed cookie, `httpOnly`, `sameSite=lax`, `secure` in prod) and the three auth endpoints from `docs/api-spec.md > Auth (BFF-owned)`: `POST /auth/login` (constant-time passphrase compare against `ORCHESTRATOR_OPERATOR_PASSPHRASE`), `POST /auth/logout` (clear cookie, 204), and `GET /auth/me` (current session). Errors are RFC 7807 `application/problem+json` per `CLAUDE.md > Error Handling`.

## Implementation Steps

### Step 1: Define server-side session and config types
**File:** `bff/src/session/types.ts`
**Action:** Create
Strict, named-export types (per `CLAUDE.md > BFF (Node) > TypeScript strict, ESM` and `Named exports only`):
- `SessionPayload { sub: 'operator'; iat: number; exp: number }` — millis since epoch, exp ≥ `iat + 8h`.
- `SignedCookie = string` brand.
- `BffConfig { sessionSecret: string; operatorPassphrase: string; sessionTtlMs: number; isProduction: boolean }`.

### Step 2: Add fail-fast config loader
**File:** `bff/src/config.ts`
**Action:** Create
- Read `SESSION_SECRET`, `ORCHESTRATOR_OPERATOR_PASSPHRASE`, `NODE_ENV` from `process.env`.
- Throw at boot if `SESSION_SECRET` or `ORCHESTRATOR_OPERATOR_PASSPHRASE` is missing **and** `NODE_ENV === 'production'`. In dev, allow weak defaults but log a single warning (no values).
- Default `sessionTtlMs = 8 * 60 * 60 * 1000` (8h, satisfies AC-2).
- Export a `loadConfig(): BffConfig` function and a memoized singleton.
- Per `CLAUDE.md > BFF (Node) > Never log the orchestrator API key`: never log secret values; only log presence/absence as a boolean.

### Step 3: Implement signed-cookie sign/verify helpers
**File:** `bff/src/session/cookie-session.ts`
**Action:** Create
Use Node's `crypto` (no third-party JWT lib needed for v1):
- `signSession(payload: SessionPayload, secret: string): string` — base64url JSON + `.` + HMAC-SHA256.
- `verifySession(token: string, secret: string): SessionPayload | null` — constant-time compare via `crypto.timingSafeEqual`; returns `null` on bad sig, malformed, or expired (`exp < Date.now()`).
- Export `SESSION_COOKIE_NAME = 'op_session'`.
- Cookie options factory `sessionCookieOptions(isProduction: boolean): CookieSerializeOptions` returning `{ httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/', maxAge: ttlMs/1000 }` — satisfies AC-4 and `CLAUDE.md > BFF (Node) > Session cookies are httpOnly, sameSite=lax, secure in production`.

### Step 4: Implement the session-required middleware (preHandler)
**File:** `bff/src/session/require-session.ts`
**Action:** Create
- Read cookie `op_session` from the request.
- Run through `verifySession`; on failure, send `401 application/problem+json` with `{ type, title: 'Unauthenticated', status: 401, code: 'unauthenticated' }` (per `docs/api-spec.md > Error Catalog`).
- On success, attach the verified payload to `request.session`.
- Export both the middleware and a typing augmentation so `request.session` is typed in handlers.
- This middleware is **not** wired to `/auth/*` routes (login is reachable unauthenticated); it is exported here for T-005 to mount on `/api/v1/*`.

### Step 5: Implement the auth route handlers
**File:** `bff/src/routes/auth.ts`
**Action:** Create
Three handlers under `/auth`:
- `POST /auth/login`:
  - Read `{ passphrase: string }` from JSON body.
  - Validate body shape; on missing/invalid → `400 invalid-intake` problem+json (or use the orchestrator's error catalog convention; for login-specific failures stay with 401).
  - Compare passphrase against `config.operatorPassphrase` using `crypto.timingSafeEqual` over equal-length buffers (constant-time, per AC-1). Pad/short-circuit must not leak length: if lengths differ, still run a dummy compare on a fixed-length buffer to keep timing flat.
  - On mismatch → `401` with `{ code: 'invalid-passphrase', title: 'Invalid passphrase', status: 401 }` (per `docs/api-spec.md > Error Catalog`).
  - On success → sign a `SessionPayload` with `iat = Date.now()` and `exp = iat + sessionTtlMs`, set the cookie via `sessionCookieOptions`, return `200 { data: { authenticated: true, expiresAt: new Date(exp).toISOString() }, meta: null }` matching the `Envelope<OperatorSession>` shape from T-003 and `docs/api-spec.md`.
- `POST /auth/logout`:
  - Clear the cookie (`reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })`) and respond `204` with no body.
- `GET /auth/me`:
  - If no cookie or `verifySession` returns null → `200 { data: { authenticated: false }, meta: null }` (per AC-3 and `docs/api-spec.md`).
  - If valid → `200 { data: { authenticated: true, expiresAt: <iso> }, meta: null }`.
- Never log the request body, the cookie value, or the configured passphrase (per Technical Note: "Do not log passphrase or session secret values").

### Step 6: Register cookie support and routes in the BFF bootstrap
**File:** `bff/src/server.ts`
**Action:** Modify
- Import the chosen framework's cookie plugin (e.g., `@fastify/cookie` for Fastify, `cookie-parser` for Express) and register with `secret: config.sessionSecret` if the plugin uses it (otherwise we sign manually in Step 3).
- Register the auth routes from `bff/src/routes/auth.ts` under prefix `/auth`.
- Boot order: load config (fail-fast), register cookie plugin, register auth routes, register `/healthz` (existing from T-001), listen.

### Step 7: Unit tests for the session and routes
**File:** `bff/src/routes/auth.spec.ts`
**Action:** Create
Vitest specs covering AC-5:
- `POST /auth/login` with correct passphrase → 200, `Set-Cookie` present, cookie has `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` ≥ 28800, and (when `NODE_ENV=production` is mocked) `Secure`.
- `POST /auth/login` with wrong passphrase → 401 problem+json with `code: 'invalid-passphrase'`, no `Set-Cookie`.
- `POST /auth/login` with missing/empty passphrase → 401 invalid-passphrase (treat as wrong, do not leak structural difference).
- `POST /auth/logout` → 204; response includes `Set-Cookie` clearing the cookie (`Max-Age=0` or `Expires` in the past).
- `GET /auth/me` with no cookie → 200 with `{ data: { authenticated: false } }`.
- `GET /auth/me` with valid cookie → 200 with `{ data: { authenticated: true, expiresAt: <iso> } }`.
- `GET /auth/me` with expired cookie (mock `Date.now`) → 200 `{ authenticated: false }` (treated as no session per AC-3).
- Constant-time compare: assert two wrong passphrases of the same length take similar time (loose bound — primarily to ensure we are not using `===`).

### Step 8: Co-located tests for the cookie-session helpers
**File:** `bff/src/session/cookie-session.spec.ts`
**Action:** Create
- Round-trip sign/verify with the right secret returns the original payload.
- Tampered payload or signature → `verifySession` returns `null`.
- Expired payload (`exp < now`) → `null`.
- Wrong secret → `null` (no exception).

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `bff/src/config.ts` | Create | Fail-fast loader for `SESSION_SECRET` and `ORCHESTRATOR_OPERATOR_PASSPHRASE`. |
| `bff/src/session/types.ts` | Create | `SessionPayload`, `BffConfig` named exports. |
| `bff/src/session/cookie-session.ts` | Create | HMAC sign/verify, cookie option factory, `SESSION_COOKIE_NAME`. |
| `bff/src/session/cookie-session.spec.ts` | Create | Round-trip, tamper, expiry, wrong-secret tests. |
| `bff/src/session/require-session.ts` | Create | preHandler middleware that 401s problem+json on missing/expired session. |
| `bff/src/routes/auth.ts` | Create | `/auth/login`, `/auth/logout`, `/auth/me` handlers. |
| `bff/src/routes/auth.spec.ts` | Create | Login success/failure, logout, expired session, cookie attribute assertions. |
| `bff/src/server.ts` | Modify | Register cookie plugin and auth routes. |

## Edge Cases & Risks
- **Constant-time compare with unequal-length buffers:** `crypto.timingSafeEqual` throws on length mismatch. Pad both sides to a fixed size (e.g., SHA-256 of each), then compare hashes — same security property, no length leak.
- **Cookie `Secure` flag in dev over plain HTTP:** when `NODE_ENV !== 'production'`, set `secure: false` so the dev `ng serve` proxy can attach it; tests must mock `NODE_ENV=production` to assert the flag flips.
- **Clock skew between issuer and verifier:** unlikely (same process) but worth noting — use `Date.now()` consistently.
- **Multiple tabs / parallel logins:** signing a fresh cookie on every login is fine; old cookies remain valid until exp. Acceptable for v1.
- **Session expiry mid-stream (raised in feature brief Risks):** this task issues the expiry; T-005's `requireSession` enforces it; T-008/T-010 handle the SPA-side redirect on the resulting `401 unauthenticated`.
- **Logging discipline:** any future request logger added at the framework level must be configured to redact `cookie` and `set-cookie` headers — call this out in the BFF README when added.

## Acceptance Verification
- [ ] **AC-1** (Login uses constant-time compare; returns `401 invalid-passphrase` on mismatch): `auth.spec.ts` asserts the 401 code; code review confirms the compare goes through `crypto.timingSafeEqual` over equal-length hashes.
- [ ] **AC-2** (Successful login sets a signed session cookie with TTL ≥ 8h and returns `expiresAt`): `auth.spec.ts` decodes `Set-Cookie`, asserts `Max-Age >= 28800` and the response body's `expiresAt` is `iat + ttl` ISO.
- [ ] **AC-3** (`GET /auth/me` returns `{ data: { authenticated: false } }` with HTTP 200 when no/expired session): `auth.spec.ts` covers both no-cookie and expired-cookie cases.
- [ ] **AC-4** (Cookie is `httpOnly`, `sameSite=lax`, `secure: true` when `NODE_ENV=production`): `auth.spec.ts` parses cookie attributes; runs assertions twice — once with `NODE_ENV=development` (no `Secure`) and once with `NODE_ENV=production` (`Secure` present).
- [ ] **AC-5** (Unit tests cover login success, login failure, logout, expired session, and cookie attribute assertions): `npm test` runs `bff/src/routes/auth.spec.ts` and `bff/src/session/cookie-session.spec.ts` green; coverage of these scenarios is enumerated in the spec descriptions.
