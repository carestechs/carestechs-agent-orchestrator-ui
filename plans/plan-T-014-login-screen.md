# Implementation Plan: T-014 — Login screen implementation

## Task Reference

- **Task ID:** T-014
- **Type:** Frontend
- **Workflow:** standard (mockup approval gated by upstream T-013)
- **Complexity:** S
- **Dependencies:** T-008 (`AuthService` + `authGuard`), T-013 (approved `mockups/login.html`)
- **Rationale (from task):** Entry point for the operator; required by the AC "An authenticated operator lands on /runs".

## Overview

Build the standalone `LoginComponent` at `/login`. It calls `AuthService.login(passphrase)` from `core/`, surfaces `code: invalid-passphrase` inline (never as a toast), redirects on success to a sanitized `?redirect=` target (or `/runs`), and renders a "session expired" banner when `?reason=expired` is present in the URL. The component follows every CLAUDE.md rule for Angular components — standalone, `templateUrl`, `styles: []`, signals for state — and the route is registered with `loadComponent` in `src/app/app.routes.ts`.

## Implementation Steps

### Step 1: Add a same-origin redirect-target sanitizer
**File:** `src/app/features/login/safe-redirect.ts`
**Action:** Create

Pure function `safeRedirectTarget(raw: string | null): string`. Default return `/runs`. Reject and fall back to `/runs` whenever the input:
- is `null`, empty, or whitespace,
- starts with `//` (protocol-relative — would jump origins),
- starts with `http:` or `https:` (case-insensitive — explicit absolute URL),
- does not start with a single `/` (relative path — could resolve outside the SPA),
- contains a backslash, a `\r` or `\n` (header injection guard).

Named export only (CLAUDE.md "Naming Conventions" + "Named exports only"). Co-located unit-test friendly.

### Step 2: Unit-test the sanitizer
**File:** `src/app/features/login/safe-redirect.spec.ts`
**Action:** Create

Vitest cases: empty/null → `/runs`; `/runs` passes through; `/runs/abc-123` passes; `//evil.com` rejected; `http://evil.com/runs` rejected; `https://evil.com` rejected; `runs` (no leading slash) rejected; `/runs\nSet-Cookie: x` rejected; `\\evil` rejected. Co-located per CLAUDE.md "Testing Conventions".

### Step 3: Create the login component class
**File:** `src/app/features/login/login.component.ts`
**Action:** Create

- `@Component({ selector: 'app-login', standalone: true, templateUrl: './login.component.html', styles: [] })` — enforces CLAUDE.md "Standalone components only", "Separate template files", "Tailwind only — no component CSS".
- Imports: `FormsModule` (or `ReactiveFormsModule` if preferred — pick one and stay consistent), `RouterLink` only if needed.
- Inject `AuthService` (from `src/app/core/auth.service.ts`, T-008), `Router`, `ActivatedRoute`. Do **not** inject `HttpClient` — components consume services per CLAUDE.md "Patterns to Follow".
- State via signals (CLAUDE.md "Signals for component state"):
  - `passphrase = signal('')`
  - `submitting = signal(false)`
  - `errorCode = signal<string | null>(null)` (the `ProblemDetails.code`)
  - `errorMessage = signal<string | null>(null)`
- `computed()` derived state:
  - `expiredBanner = computed(() => this.route.snapshot.queryParamMap.get('reason') === 'expired')` (or read once in constructor and store in a signal — pick the simpler form, but keep it `computed`/derived).
  - `redirectTarget = computed(() => safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirect')))`.
- Method `submit()`:
  1. If `submitting()` is true, return (prevents double-submit, satisfies AC-3).
  2. Clear `errorCode`, `errorMessage`. Set `submitting.set(true)`.
  3. Call `authService.login(passphrase())`. Bridge the resulting observable into the flow with `firstValueFrom` (or `subscribe`); use `toSignal()` only if you keep a long-lived stream — for a one-shot RPC, `firstValueFrom` is cleaner.
  4. On success: `router.navigateByUrl(this.redirectTarget())`.
  5. On error: if it is a `ProblemDetailsError` (T-007) with `code === 'invalid-passphrase'`, set `errorCode.set('invalid-passphrase')` and `errorMessage.set('Incorrect passphrase.')` — inline only, never call the toast service (AC-2 + task-specific note). For any other error, set a generic `errorMessage` ("Couldn't reach the server. Try again.") and still keep it inline.
  6. Always `submitting.set(false)` in a `finally`.
- Named export `LoginComponent`. Add `export default LoginComponent` ONLY if the route file uses `loadComponent: () => import('./login.component')` directly. Per CLAUDE.md exception: "the file's only purpose is to re-export the component as default" — prefer placing the default export in a tiny re-export file (Step 5) instead, so the component file stays clean.

### Step 4: Create the login template
**File:** `src/app/features/login/login.component.html`
**Action:** Create

Tailwind-only markup (no `style` attributes, no class indirection through component CSS — CLAUDE.md "Tailwind only"). Use modern-minimal tokens from `docs/ui-specification.md` § "Design System (Modern Minimal)" and "Screen: Login":

- Outer wrapper: `min-h-screen bg-slate-50 flex items-center justify-center px-4`.
- Card: `bg-white rounded-lg shadow-sm p-6 w-full max-w-md` (elevated card, no border).
- Heading: `<h1 class="font-[Poppins] text-slate-900 text-2xl font-semibold mb-1">Sign in</h1>` plus a subtitle in `text-slate-500 text-sm`.
- `@if (expiredBanner()) { ... }` block above the form: `bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2 text-sm` reading "Your session expired. Please sign in again." (status-color amber per design system "warning").
- Form `(ngSubmit)="submit()"`:
  - Label `Passphrase` (`text-sm font-medium text-slate-700`).
  - `<input type="password" [ngModel]="passphrase()" (ngModelChange)="passphrase.set($event)" name="passphrase" required autocomplete="current-password" class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-500 focus:ring-2 focus:ring-sky-100">` plus `aria-invalid` bound to `errorCode() !== null` and `aria-describedby="login-error"` when erroring.
  - Submit button: `class="w-full rounded-lg bg-sky-500 hover:bg-sky-600 active:translate-y-px text-white px-4 py-2 disabled:opacity-50"` with `[disabled]="submitting() || !passphrase()"`.
  - Inline error block `@if (errorMessage()) { <p id="login-error" class="text-red-600 text-sm mt-2">{{ errorMessage() }}</p> }` — never invokes the toast service.
  - When `submitting()` is true, render an inline spinner inside the button.

### Step 5: Register the lazy route via `loadComponent`
**File:** `src/app/app.routes.ts`
**Action:** Modify

Append (or insert in route order) a public route:

```ts
{
  path: 'login',
  loadComponent: () =>
    import('./features/login/login.component').then(m => m.LoginComponent),
},
```

CLAUDE.md "Lazy routes use `loadComponent`. Never `loadChildren` pointing to a module." If the project standard is to use `default export` with `loadComponent: () => import(...)` directly, add a one-line `export default LoginComponent;` at the bottom of `login.component.ts` per the CLAUDE.md "Named exports only" exception.

### Step 6: Component spec
**File:** `src/app/features/login/login.component.spec.ts`
**Action:** Create

Vitest with Angular TestBed. Cover:
- **Success redirect:** mock `AuthService.login` to resolve; with `?redirect=/runs/abc`, assert `router.navigateByUrl('/runs/abc')`.
- **Default redirect:** no `?redirect`, assert navigation to `/runs`.
- **Reject unsafe redirects:** `?redirect=//evil.com` and `?redirect=https://evil.com` → both navigate to `/runs`.
- **Failure (invalid passphrase):** mock login to reject with `ProblemDetailsError({ status: 401, code: 'invalid-passphrase' })`. Assert (a) the inline error text appears, (b) the `ToastService` is not called (spy on `core/toast.service` and verify zero calls — task-specific note), (c) `submitting()` is back to `false`.
- **Expired banner:** with `?reason=expired`, assert the amber banner renders.
- **Double-submit guard:** trigger `submit()` twice synchronously; assert `AuthService.login` was called once.

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `src/app/features/login/safe-redirect.ts` | Create | Same-origin redirect-target whitelist function. |
| `src/app/features/login/safe-redirect.spec.ts` | Create | Unit tests for the sanitizer. |
| `src/app/features/login/login.component.ts` | Create | Standalone component, signals state, calls `AuthService`. |
| `src/app/features/login/login.component.html` | Create | Tailwind-only template, modern-minimal tokens, expired banner, inline error. |
| `src/app/features/login/login.component.spec.ts` | Create | Component test for success/failure/expired/double-submit. |
| `src/app/app.routes.ts` | Modify | Register `/login` via `loadComponent`. |

## Edge Cases & Risks

- **Open-redirect:** `?redirect=//evil.com` and `?redirect=https://evil.com/runs` both look "URL-ish" and would silently exfiltrate the session if not blocked. The sanitizer rejects anything not starting with a single `/`. Covered by Step 1+2.
- **Already authenticated user hitting `/login`:** UX nicety — if `AuthService.session()` shows authenticated, redirect immediately to the safe target. Optional polish; not gated by the AC.
- **`401 invalid-passphrase` vs other 401s:** the auth interceptor in T-008 routes mid-session 401s to `/login?reason=expired`. On the login page itself we must not loop — only act on `code === 'invalid-passphrase'` and ignore the global "auth-expired" channel here (or unsubscribe from it inside the login component).
- **Browser autofill races the `submitting()` guard:** when autofill triggers a submit before signals settle, the second guard check inside `submit()` (Step 3, point 1) catches it.
- **Translation of `ProblemDetails.title`:** the spec maps `code: invalid-passphrase` to the literal copy "Incorrect passphrase." We do not surface `ProblemDetails.title` from the server because it may leak internal phrasing; the inline copy is hard-coded.
- **Toast leak:** Easy to accidentally call `toastService.error(...)` from a generic catch arm. The spec asserts zero toast calls on `invalid-passphrase` to lock this in.

## Acceptance Verification

- [ ] **AC-1 — Successful login redirects to `redirect` (whitelisted to same-origin) or `/runs`:** Spec cases "Success redirect", "Default redirect", and "Reject unsafe redirects" assert `router.navigateByUrl` lands on the safe target for valid input and falls back to `/runs` for `//…` and `https://…` inputs.
- [ ] **AC-2 — Wrong passphrase shows inline error keyed off `code: invalid-passphrase`; no toast:** Spec case "Failure (invalid passphrase)" asserts the inline `text-red-600` element renders and `ToastService` was not called.
- [ ] **AC-3 — Submit disabled while in flight; no double-submit:** Spec case "Double-submit guard" asserts only one `AuthService.login` invocation; template binds `[disabled]="submitting() || !passphrase()"`.
- [ ] **AC-4 — Component test covers success, failure, expired-banner:** All three covered in `login.component.spec.ts`.
- [ ] **Task-specific note — Session expired banner:** Spec case "Expired banner" with `?reason=expired` asserts the amber banner is in the DOM.
