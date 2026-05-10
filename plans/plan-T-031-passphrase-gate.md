# Implementation Plan: T-031 — Replace cookie-session login with a SPA-side passphrase gate

## Task Reference
- **Task ID:** T-031
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** M
- **Dependencies:** T-029 (env files for the configured passphrase)
- **Rationale:** Implements the locked-in decision from the FEAT brief (SPA-side gate, sessionStorage, no backend call) without touching `ApiClient` (T-030) or BFF deletion (T-032).

## Overview
The login flow today posts to `/auth/login` (BFF) and tracks a cookie session. After this task it's purely client-side: the typed value is compared against `environment.operatorPassphrase`; on match a flag lands in `sessionStorage`; the route guard reads the flag. Network calls to `/auth/*` disappear. The 401 → `?reason=expired` flow stays — `notifyAuthExpired()` now also clears the flag.

## Implementation Steps

### Step 1: Define a tiny passphrase store
**File:** `src/app/core/operator-gate.ts`
**Action:** Create

A handful of pure functions around `sessionStorage`:

```ts
const KEY = 'ao.operator.unlocked';

export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'true';
  } catch {
    // Private mode or storage disabled — fail closed.
    return false;
  }
}

export function unlock(): void {
  try { sessionStorage.setItem(KEY, 'true'); } catch { /* best-effort */ }
}

export function lock(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* best-effort */ }
}
```

- The `try/catch` blocks cover Safari private mode (storage throws). Failing closed on read is intentional — better a re-prompt than a false-unlock.

### Step 2: Replace `AuthService` internals
**File:** `src/app/core/auth.service.ts`
**Action:** Modify

- Remove `ApiClient` injection; remove `import { authExpired } from './auth-events'` if it's only used for the effect (keep it if still consumed).
- Replace `me()` / `login()` / `logout()` with synchronous gate operations:
  ```ts
  me(): Observable<OperatorSession> {
    return of({ authenticated: isUnlocked() }).pipe(
      tap((s) => this._session.set(s)),
    );
  }
  login(passphrase: string): Observable<OperatorSession> {
    if (passphrase === environment.operatorPassphrase) {
      unlock();
      const session: OperatorSession = { authenticated: true };
      this._session.set(session);
      return of(session);
    }
    return throwError(() => new ProblemDetailsError({
      type: 'about:blank',
      title: 'Incorrect passphrase.',
      status: 401,
      code: 'invalid-passphrase',
    }));
  }
  logout(): Observable<void> {
    lock();
    this._session.set({ authenticated: false });
    return of(undefined);
  }
  ```
- Keep the `Observable` return shapes so callers don't change signatures. The login form already does `await firstValueFrom(...)`.
- `handleExpiry()` keeps its current behavior but additionally calls `lock()` before navigating.

### Step 3: Update `authGuard`
**File:** `src/app/core/auth.guard.ts`
**Action:** Modify

The guard's flow stays — but now there's no async probe needed. Simplify:

```ts
export const authGuard: CanMatchFn = (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.authenticated() || isUnlocked()) {
    if (!auth.authenticated()) auth.me().subscribe(); // sync the signal
    return true;
  }
  const target = '/' + segments.map((s) => s.path).join('/');
  const skipRedirect = target === '/' || target === '/login';
  return skipRedirect
    ? router.parseUrl('/login')
    : router.parseUrl('/login?redirect=' + encodeURIComponent(target));
};
```

- `auth.me()` is now synchronous (returns `of(...)` immediately), so the existing `pipe(map(...), catchError(...))` branch becomes dead code; delete it.

### Step 4: Login component — drop the network branch's specific copy
**File:** `src/app/features/login/login.component.ts`
**Action:** Modify

The component already calls `this.auth.login(value)` and catches `ProblemDetailsError` with `code === 'invalid-passphrase'`. Since AuthService now throws exactly that shape on mismatch, this code keeps working. The only change: the catch-all "Couldn't reach the server. Try again." message is no longer reachable (no network) — leave the branch as a defensive fallback but the realistic path is always the `invalid-passphrase` branch.

No template changes needed.

### Step 5: Update tests
**Files:**
- `src/app/core/auth.service.spec.ts`
- `src/app/core/auth.guard.spec.ts` (create if not present; check current test coverage)
- `src/app/features/login/login.component.spec.ts`

**Action:** Modify

- `auth.service.spec.ts`: remove `HttpTestingController` setup; manipulate `sessionStorage` directly between tests. Cover: valid passphrase unlocks; invalid passphrase throws `ProblemDetailsError(invalid-passphrase)`; logout locks; `me()` reflects current sessionStorage state; `handleExpiry()` calls `lock()` and navigates.
- `login.component.spec.ts`: Update mocks — `AuthService.login` returns `of(...)` on match, `throwError(...)` on mismatch. The existing test cases for invalid-passphrase inline error continue to apply.
- Add a test for the `operator-gate.ts` helpers (round-trip lock/unlock + private-mode resilience by mocking `sessionStorage.setItem` to throw).

### Step 6: `auth-events.ts` — confirm the channel still makes sense
**File:** `src/app/core/auth-events.ts`
**Action:** Verify (no change expected)

- The channel exists to broadcast a 401 from any HTTP layer to `AuthService`. After this task, only orchestrator 401s (rotated key) trigger it — same shape.
- Add a one-line comment clarifying the new trigger source so future readers don't think it relates to a session cookie.

### Step 7: Smoke
**Action:** Verify

- `npm test` (all SPA unit tests).
- Manual: launch the SPA against an upstream mock; type wrong passphrase → inline error; type right passphrase → navigates to `/runs`; close tab, reopen → re-prompted (sessionStorage gone); 401 on `/v1/runs` → redirected to `/login?reason=expired`.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/core/operator-gate.ts` | Create | `isUnlocked` / `unlock` / `lock` around `sessionStorage`. |
| `src/app/core/operator-gate.spec.ts` | Create | Round-trip + private-mode resilience. |
| `src/app/core/auth.service.ts` | Modify | Synchronous gate operations; no HTTP. |
| `src/app/core/auth.service.spec.ts` | Modify | Drop HTTP mocks; sessionStorage-based. |
| `src/app/core/auth.guard.ts` | Modify | Synchronous check; remove async probe path. |
| `src/app/core/auth.guard.spec.ts` | Create or modify | Cover authenticated/unauthenticated branches. |
| `src/app/core/auth-events.ts` | Verify | Add a clarifying comment about the new trigger. |
| `src/app/features/login/login.component.spec.ts` | Modify | Update AuthService mocks. |

## Edge Cases & Risks
- **Safari private mode / storage disabled.** `sessionStorage` calls throw. The helpers fail closed (return `false` from `isUnlocked`); user is re-prompted every navigation. Acceptable for an interim gate.
- **Race between `authGuard` and `AuthService.me()`.** The guard does a synchronous `isUnlocked()` check first, so no race on the happy path. The `auth.me().subscribe()` after-the-fact is just to keep the `_session` signal in sync.
- **Browser tab restored from session.** Some browsers rehydrate `sessionStorage` on tab restore; some don't. We are not relying on this either way — the gate is per-tab on purpose.
- **Test cross-contamination via `sessionStorage`.** Tests must `sessionStorage.clear()` in a `beforeEach` to avoid bleeding state. Bake into the test setup.
- **The Login component's "Couldn't reach the server" fallback.** Strictly unreachable now; leave it as a defensive branch (cheap) and add a comment so a reviewer doesn't try to test it.

## Acceptance Verification
- [ ] `LoginComponent` makes no HTTP call. Verified by spec (no `HttpTestingController.expectOne`).
- [ ] Valid passphrase unlocks; invalid surfaces the same `invalid-passphrase` inline error as today.
- [ ] `authGuard` allows the route iff `isUnlocked()` returns true. Mid-route 401 clears the flag and redirects to `/login?reason=expired`.
- [ ] No code references `/auth/login`, `/auth/logout`, or `/auth/me`.
- [ ] `operator-gate.spec.ts` covers private-mode resilience.
- [ ] All unit tests pass.
