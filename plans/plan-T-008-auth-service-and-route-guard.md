# Implementation Plan: T-008 — AuthService and route guard

## Task Reference
- **Task ID:** T-008
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** Required for the AC "session expiry mid-stream cleanly redirects to /login?reason=expired" called out as a risk in FEAT-001.

## Overview
Implement `AuthService` (login, logout, `me()` probe, writable `session` signal) and a `CanMatchFn` route guard that gates every non-public route. The guard performs the bootstrap `/auth/me` probe on first navigation and watches the global `authExpired` signal from T-007 so any mid-session 401 — including one fired by the NDJSON trace stream (T-010) — funnels back to `/login?reason=expired` exactly once. Login redirects use a same-origin-whitelisted `redirect` query param so the operator returns to the page they tried to open.

## Implementation Steps

### Step 1: Implement `AuthService`
**File:** `src/app/core/auth.service.ts`
**Action:** Create
`@Injectable({ providedIn: 'root' })` class with named export. Inject `ApiClient` (T-007).

State (per `CLAUDE.md` "Signals for component state"):
- `private readonly _session = signal<OperatorSession | null>(null);` — `null` means "not yet probed".
- `readonly session = this._session.asReadonly();`
- `readonly authenticated = computed(() => this._session()?.authenticated === true);`

Methods (RxJS only at the HTTP boundary, per `CLAUDE.md` "RxJS is reserved for HttpClient"; results are written into the signal so consumers stay signal-native):
- `me(): Observable<OperatorSession>` — `apiClient.get<OperatorSession>('/auth/me')`, `.pipe(tap(({ data }) => this._session.set(data)), map(({ data }) => data))`. Per `docs/api-spec.md` § Auth, this returns `{ authenticated: false }` (HTTP 200) when no session — the guard relies on that, not on a 401.
- `login(passphrase: string): Observable<OperatorSession>` — `POST /auth/login` with body `{ passphrase }`, `tap` to set session on success.
- `logout(): Observable<void>` — `POST /auth/logout`, `tap` to set `_session.set({ authenticated: false })`. Tolerates the 204 empty body documented in T-007 Step 4.

Use `OperatorSession` from `src/app/models/auth.model.ts` (per T-003 / `docs/data-model.md` Module Ownership).

### Step 2: Wire the global expiry listener
**File:** `src/app/core/auth.service.ts`
**Action:** Modify (continuation of Step 1)
Inside the `AuthService` constructor, register a single `effect()` that watches `authExpired` (from `src/app/core/auth-events.ts`, T-007) and, when it changes from its initial value, calls a `private redirectToExpiredLogin()` helper. The helper:
- Reads `Router.url`. If it already starts with `/login`, **return without redirecting** — satisfies AC "Guard does not cause a redirect loop on /login itself".
- Otherwise: `_session.set({ authenticated: false })`, then `router.navigateByUrl('/login?reason=expired', { replaceUrl: true })`.

Use `Router` injected via `inject()`. Guard against double-fire by storing the last-handled counter value.

### Step 3: Implement the `authGuard` as `CanMatchFn`
**File:** `src/app/core/auth.guard.ts`
**Action:** Create
Export `authGuard: CanMatchFn` (named export). Per `CLAUDE.md` "Lazy routes use loadComponent" / standalone-only conventions, this is a function, not a class.

Behavior:
1. `inject(AuthService)`, `inject(Router)`.
2. If `auth.session()` is already populated and `auth.authenticated()` is `true`, return `true` immediately.
3. Otherwise call `auth.me()` (returns `Observable<OperatorSession>`). Map to:
   - `data.authenticated === true` → `true`.
   - `false` → build the redirect:
     - Read the original target from the `CanMatchFn`'s second arg (`segments: UrlSegment[]`); reconstruct as `'/' + segments.map(s => s.path).join('/')`.
     - Skip the `redirect=` param entirely if the target is `/login` or `/` (avoids `/login?redirect=/login`).
     - Return `router.parseUrl('/login?redirect=' + encodeURIComponent(target))` → satisfies AC "Visiting /runs while logged out lands on /login?redirect=/runs".
4. On error (network failure on `/auth/me`), redirect to `/login` without `redirect` and without `reason=expired` (operator can retry).

### Step 4: Apply the guard to non-public routes
**File:** `src/app/app.routes.ts`
**Action:** Modify
Add `canMatch: [authGuard]` to every non-public route. Public routes are `/login` and the root redirect. Concretely (final wiring will be completed in T-014/T-016/T-018, but the structure is set here):

```ts
export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'runs' },
  { path: 'login', loadComponent: () => import('./features/login/login.component').then(m => m.default) },
  { path: 'runs', canMatch: [authGuard], loadComponent: () => import('./features/runs-list/runs-list.component').then(m => m.default) },
  { path: 'runs/:id', canMatch: [authGuard], loadComponent: () => import('./features/run-detail/run-detail.component').then(m => m.default) },
];
```

Per `CLAUDE.md` "Named exports only — except where Angular's loadComponent requires a default export from a route file": the route component files re-export their named class as default; the `authGuard` itself is a named export.

### Step 5: Unit tests
**File:** `src/app/core/auth.service.spec.ts`
**Action:** Create
Vitest cases covering all four ACs:
- **Login → guard pass.** With `auth/me` mocked to `{ authenticated: false }` then login mocked to `{ authenticated: true }`, the guard for `/runs` returns a redirect to `/login?redirect=%2Fruns` first, then after `auth.login()` returns `true`. Asserts `session` signal updates atomically.
- **401 mid-session triggers `?reason=expired`.** Bump `authExpired`; assert `router.navigateByUrl` was called with `/login?reason=expired` exactly once. Bump again (e.g. a second 401 from a parallel request); assert no second navigation occurs while already on `/login`.
- **No loop on `/login`.** With `Router.url === '/login?reason=expired'`, bumping `authExpired` again must not trigger another `navigateByUrl`.
- **Logout clears session.** After `logout()`, `auth.authenticated()` is `false`.

Co-locate spec per `CLAUDE.md` Testing Conventions.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/core/auth.service.ts` | Create | Login/logout/me, signal-backed session, mid-session expiry effect. |
| `src/app/core/auth.guard.ts` | Create | `CanMatchFn` that probes `/auth/me`, redirects with `redirect=` or `reason=expired`. |
| `src/app/app.routes.ts` | Modify | Apply `canMatch: [authGuard]` to non-public routes. |
| `src/app/core/auth.service.spec.ts` | Create | Covers redirect, expiry, no-loop, logout. |

## Edge Cases & Risks
- **Redirect loop on `/login`.** Two layers of defense: (a) `app.routes.ts` does not put `authGuard` on `/login`; (b) the expiry effect in Step 2 short-circuits when the URL already starts with `/login`. Both are needed: a stale `authExpired` increment can fire after the user has manually navigated to `/login`.
- **`redirect` param as open-redirect vector.** The guard only constructs `redirect` from the in-app `UrlSegment[]` (always relative). The login screen (T-014) is responsible for whitelisting the param to same-origin paths starting with `/`. Note this here so T-014 doesn't forget.
- **Bootstrap race.** If multiple guarded routes resolve simultaneously, `auth.me()` could fire twice. Acceptable for v1 (idempotent GET); document so we don't add an unnecessary cache layer.
- **`/auth/me` returning `{ authenticated: false }` is HTTP 200, not 401** — confirmed by `docs/api-spec.md`. The guard must NOT treat the absence of a session as an "expired" event; only `code: unauthenticated` from `/api/v1/*` should trigger that path. T-007 Step 4 already excludes `/auth/me` from `notifyAuthExpired()`.
- **`canMatch` vs `canActivate`.** `canMatch` runs before lazy chunks load — preferred per task spec. If guard returns a `UrlTree`, the router navigates instead of matching, which is exactly what we want for the redirect.

## Acceptance Verification
- [ ] AC "Visiting /runs while logged out lands on /login?redirect=/runs; after login, returns to /runs" — verified by the login spec in Step 5 (guard returns `UrlTree` to `/login?redirect=%2Fruns`); the post-login bounce is implemented in T-014 but the redirect param production is locked in here.
- [ ] AC "A 401 emitted by ApiClient mid-session triggers redirect to /login?reason=expired exactly once" — verified by the expiry spec asserting a single `navigateByUrl` call.
- [ ] AC "session signal updates atomically on login/logout" — verified by the logout-clears-session spec and the login-sets-session assertion.
- [ ] AC "Guard does not cause a redirect loop on /login itself" — verified by the no-loop spec plus the `app.routes.ts` configuration omitting the guard on `/login`.
- [ ] Convention check: standalone routing via `loadComponent`, named exports for guard/service, no NgModules, signals for state — verified against `CLAUDE.md`.
