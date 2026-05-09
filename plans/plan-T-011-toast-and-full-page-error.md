# Implementation Plan: T-011 — Toast service and global error boundary

## Task Reference
- **Task ID:** T-011
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** Required by the FEAT-001 AC "page degrades gracefully when the BFF returns 502 (full-page error with retry)" and by the error catalog rows in `docs/api-spec.md` that map to "Toast" or "Full-page error with retry".

## Overview
Two cross-cutting UI primitives:

1. **`ToastService` + `ToastHostComponent`** — a signal-backed queue surfaced via a single host component mounted once in the app shell. Variants `success`, `info`, `error` per `docs/ui-specification.md` § Cross-cutting Components. Auto-dismiss after 4s for non-error toasts; errors persist until dismissed by the user. De-duplicates identical messages within a 1s window so retry loops can't spam the queue.
2. **`FullPageErrorComponent`** — full-viewport error state used when the BFF returns terminal failures (`500 upstream-unavailable`, `502 upstream-error` per `docs/api-spec.md` Error Catalog). Renders the `ProblemDetails.title` plus a `Retry` button bound to a caller-supplied callback.

Both components are standalone with `templateUrl` and `styles: []`, using only modern-minimal Tailwind tokens — per `CLAUDE.md` Code Style "Tailwind only — no component CSS" and "Separate template files".

## Implementation Steps

### Step 1: `Toast` model and `ToastService`
**File:** `src/app/shared/toast.service.ts`
**Action:** Create
Named-export interface and service:

```ts
export type ToastVariant = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  body?: string;
}
```

`@Injectable({ providedIn: 'root' })` class `ToastService`. State (per `CLAUDE.md` "Signals for component state"):
- `private readonly _toasts = signal<Toast[]>([]);`
- `readonly toasts = this._toasts.asReadonly();`
- `private nextId = 1;`
- `private readonly recent = new Map<string, number>();` — maps `${variant}|${title}|${body ?? ''}` → last-shown timestamp; used for the 1s dedupe window.

Public API:
```ts
success(title: string, body?: string): void;
info(title: string, body?: string): void;
error(title: string, body?: string): void;
dismiss(id: number): void;
```

`success`/`info`/`error` delegate to a single private `enqueue(variant, title, body)`:
1. Build the dedupe key. If `Date.now() - recent.get(key)` is `< 1000`, return without enqueuing — satisfies AC "No duplicate identical toasts within a 1s window."
2. `recent.set(key, Date.now())`. Trim the map opportunistically when it exceeds 32 entries to bound memory.
3. `const toast = { id: nextId++, variant, title, body };` push via `_toasts.update(arr => [...arr, toast])`.
4. If `variant !== 'error'`, schedule `setTimeout(() => this.dismiss(toast.id), 4000)` — satisfies AC "auto-dismiss after 4s for success/info, persist until dismissed for errors", per `docs/ui-specification.md` § Cross-cutting Components (authoritative source for cross-cutting UI behavior).

`dismiss(id)`: `_toasts.update(arr => arr.filter(t => t.id !== id))`.

### Step 2: `ToastHostComponent`
**File:** `src/app/shared/toast-host.component.ts`
**Action:** Create
Standalone `@Component` with `selector: 'app-toast-host'`, `standalone: true`, `templateUrl: './toast-host.component.html'`, `styles: []` — every one of those is a `CLAUDE.md` Code Style requirement ("Standalone components only", "Separate template files", "Tailwind only — no component CSS. Set `styles: []` in every `@Component`").

Class:
- Inject `ToastService` via `inject()`.
- Expose `toasts = this.toastService.toasts` for the template.
- Method `onDismiss(id: number): void { this.toastService.dismiss(id); }`.

Named export `ToastHostComponent`.

### Step 3: `ToastHostComponent` template
**File:** `src/app/shared/toast-host.component.html`
**Action:** Create
Tailwind-only template using modern-minimal tokens (`CLAUDE.md` § Design System). Sketch:

```html
<div class="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm" aria-live="polite">
  @for (t of toasts(); track t.id) {
    <div
      class="rounded-lg shadow-md p-4 flex items-start gap-3 bg-white border-l-4"
      [class.border-emerald-500]="t.variant === 'success'"
      [class.border-sky-500]="t.variant === 'info'"
      [class.border-red-500]="t.variant === 'error'"
      role="status">
      <div class="flex-1">
        <p class="font-medium text-slate-900">{{ t.title }}</p>
        @if (t.body) { <p class="text-sm text-slate-600 mt-1">{{ t.body }}</p> }
      </div>
      <button
        type="button"
        class="text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
        (click)="onDismiss(t.id)"
        aria-label="Dismiss notification">×</button>
    </div>
  }
</div>
```

`aria-live="polite"` matches `docs/ui-specification.md` § Accessibility. Variant colors come from the modern-minimal status palette (`emerald-500` success, `sky-500` info, `red-500` error) — `CLAUDE.md` § Design System.

### Step 4: Mount the host once in the app shell
**File:** `src/app/app.component.html`
**Action:** Modify
Append `<app-toast-host />` at the end of the root template so toasts overlay every route. In `src/app/app.component.ts`, add `ToastHostComponent` to the `imports` array (standalone import per `CLAUDE.md` "Standalone components only" — no NgModule).

### Step 5: `FullPageErrorComponent`
**File:** `src/app/shared/full-page-error.component.ts`
**Action:** Create
Standalone, `templateUrl`, `styles: []`. Named export `FullPageErrorComponent`.

Inputs (signal-based per `CLAUDE.md` "Signals for component state"):
```ts
title = input.required<string>();          // From ProblemDetails.title
detail = input<string | undefined>();
code = input<string | undefined>();
retry = input<(() => void) | undefined>(); // Caller-supplied retry; if undefined, hide button.
```

The `retry` input is the AC "full-page error supports a Retry callback" — feature components (`RunsListComponent` T-016 / `RunDetailComponent` T-018) pass a closure that re-runs the failing operation.

### Step 6: `FullPageErrorComponent` template
**File:** `src/app/shared/full-page-error.component.html`
**Action:** Create
Tailwind-only, modern-minimal tokens, reading-focused width:

```html
<div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-12 max-w-md mx-auto">
  <div class="rounded-full bg-red-100 p-3 mb-4" aria-hidden="true">
    <!-- inline svg icon, slate-300 stroke, no images -->
  </div>
  <h1 class="text-xl font-semibold text-slate-900 mb-2">{{ title() }}</h1>
  @if (detail()) { <p class="text-slate-600 mb-2">{{ detail() }}</p> }
  @if (code()) { <p class="text-xs text-slate-400 font-mono">{{ code() }}</p> }
  @if (retry()) {
    <button
      type="button"
      class="mt-6 rounded-lg bg-sky-500 hover:bg-sky-600 active:translate-y-px text-white px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
      (click)="retry()!()">Retry</button>
  }
</div>
```

Button matches `docs/ui-specification.md` § Components ("Buttons: rounded-lg, primary sky bg, white text, focus ring"). No component CSS.

### Step 7: Unit tests
**File:** `src/app/shared/toast.service.spec.ts`
**Action:** Create
Vitest cases (`vi.useFakeTimers()`):
- `success('Hi')` adds a toast; advancing 4000ms removes it.
- `error('Boom')` persists indefinitely; advance 60s and assert still present.
- `info` followed by an identical `info` within 1s adds only one toast; after >1s a second succeeds.
- `dismiss(id)` removes the targeted toast.

**File:** `src/app/shared/toast-host.component.spec.ts`
**Action:** Create
Component test using Angular's `TestBed.createComponent` + `provideZonelessChangeDetection()` (signal-driven). Assert that adding a toast to `ToastService` causes the host to render a node with the right variant border class. Per `CLAUDE.md` Testing Conventions: "Component tests focus on signal-driven behavior, not Tailwind class assertions" — assert on the rendered text and `role="status"` count, plus a single sentinel class assertion (`border-red-500` for an error toast).

**File:** `src/app/shared/full-page-error.component.spec.ts`
**Action:** Create
Cases:
- Renders `title` input.
- Hides Retry button when `retry` input is undefined.
- Clicking Retry invokes the supplied callback exactly once.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/shared/toast.service.ts` | Create | Signal-backed toast queue with auto-dismiss + 1s dedupe. |
| `src/app/shared/toast-host.component.ts` | Create | Standalone host component, `templateUrl`, `styles: []`. |
| `src/app/shared/toast-host.component.html` | Create | Tailwind template, aria-live region, variant border. |
| `src/app/app.component.html` | Modify | Mount `<app-toast-host />` at root once. |
| `src/app/app.component.ts` | Modify | Add `ToastHostComponent` to standalone imports. |
| `src/app/shared/full-page-error.component.ts` | Create | Title/detail/code/retry inputs (signal inputs). |
| `src/app/shared/full-page-error.component.html` | Create | Centered Tailwind layout, optional Retry button. |
| `src/app/shared/toast.service.spec.ts` | Create | Auto-dismiss, persist-on-error, dedupe, dismiss. |
| `src/app/shared/toast-host.component.spec.ts` | Create | Renders queued toasts. |
| `src/app/shared/full-page-error.component.spec.ts` | Create | Inputs + Retry callback. |

## Edge Cases & Risks
- **`setTimeout` leaks.** When a toast is manually dismissed before 4s, the scheduled `setTimeout` still fires later; `dismiss` handles missing IDs gracefully (filter is a no-op). Acceptable. If we ever clear timers, we'd track them in a `Map<id, Timer>`.
- **Memory of `recent` dedupe map.** Bounded by the 32-entry trim in Step 1. Without the bound, a long-running session emitting unique toasts could grow forever.
- **Accessibility.** `aria-live="polite"` is correct for non-blocking announcements (matches the trace stream's same choice in `docs/ui-specification.md`); errors do NOT use `assertive` because we don't want to interrupt screen-reader flow on every transient failure. Lighthouse a11y ≥ 95 (T-021) is the eventual gate.
- **Retry callback throws.** `FullPageErrorComponent` calls `retry()()` directly. If the callback throws synchronously, Angular's error handler logs it; the page stays as-is. Acceptable — feature screens own the reliability of their retry closures.
- **Multiple retry clicks.** The button is not disabled while the retry is pending. Feature screens (T-016/T-018) own the loading state of the operation and can swap out the error for a spinner once retry is initiated. Document so we don't add disabled-state logic into the shared component.

## Acceptance Verification
- [ ] AC "Toasts auto-dismiss after 4s for success/info, persist until dismissed for errors" — Step 7 service spec covers both branches with fake timers.
- [ ] AC "Full-page error renders with modern-minimal tokens and a Retry button that re-runs the failing operation" — Step 6 template uses the documented tokens; Step 7 component spec verifies the callback wiring.
- [ ] AC "No duplicate identical toasts within a 1s window" — Step 1 dedupe map + Step 7 dedupe spec case.
- [ ] Convention check: standalone, `templateUrl`, `styles: []`, Tailwind-only, named exports, signals for state — verified per `CLAUDE.md` Code Style sections "Standalone components only", "Separate template files", "Tailwind only — no component CSS", "Signals for component state".
