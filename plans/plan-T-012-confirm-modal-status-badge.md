# Implementation Plan: T-012 — Confirmation modal and status badge components

## Task Reference
- **Task ID:** T-012
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** Both components appear on multiple screens (runs list, run detail) and must be standardized per `docs/ui-specification.md` § Status Badge Mapping and § Cross-cutting Components.

## Overview
Two reusable shared components:

1. **`ConfirmModalComponent`** (`<app-confirm-modal>`) — generic confirmation dialog used by Cancel run (T-018) and any future destructive action. Imperative API returning a `Promise<boolean>` so feature components can `await` the operator's choice. Traps focus inside the dialog, closes on `Esc` (resolves `false`), closes on backdrop click or "Cancel" (resolves `false`), resolves `true` on the primary "Confirm" button.
2. **`RunStatusBadgeComponent`** (`<app-run-status-badge>`) — pill that maps `RunStatus` to the bg/text classes in `docs/ui-specification.md` § Status Badge Mapping (authoritative). Reused for trace executor-call states per the same spec section.

Both standalone, `templateUrl`, `styles: []`, Tailwind-only — `CLAUDE.md` Code Style.

## Implementation Steps

### Step 1: `RunStatusBadgeComponent`
**File:** `src/app/shared/run-status-badge.component.ts`
**Action:** Create
Standalone component with `selector: 'app-run-status-badge'`, `standalone: true`, `templateUrl: './run-status-badge.component.html'`, `styles: []`. Named export.

Inputs (signal inputs per `CLAUDE.md` "Signals for component state"):
```ts
status = input.required<RunStatus | ExecutorCallState | TraceStepState>();
```

Where `RunStatus` is from `src/app/models/run.model.ts` (`'running' | 'paused' | 'completed' | 'failed' | 'cancelled'`) and the additional unions accommodate the trace re-use noted in `docs/ui-specification.md` § Status Badge Mapping ("Same component reused for trace executor-call states (`dispatched`, `completed`, `failed`)"). Define a private `BadgeStyle` type and a `BADGE_STYLES` const map (UPPER_SNAKE per `CLAUDE.md` Naming):

```ts
const BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  running:    { bg: 'bg-sky-100',     text: 'text-sky-700',     label: 'Running'    },
  paused:     { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Paused'     },
  completed:  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed'  },
  failed:     { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Failed'     },
  cancelled:  { bg: 'bg-slate-200',   text: 'text-slate-600',   label: 'Cancelled'  },
  dispatched: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Awaiting'   },
  // executor 'completed' / 'failed' fall through to the same keys above
};

readonly style = computed(() => BADGE_STYLES[this.status()] ?? BADGE_STYLES.cancelled);
```

The bg/text classes come straight from `docs/ui-specification.md` § Status Badge Mapping (authoritative): `running`→`bg-sky-100 text-sky-700`, `paused`→`bg-amber-100 text-amber-700`, `completed`→`bg-emerald-100 text-emerald-700`, `failed`→`bg-red-100 text-red-700`, `cancelled`→`bg-slate-200 text-slate-600`. No status-dot synthesis — the pill uses bg + label only, matching the documented design.

### Step 2: `RunStatusBadgeComponent` template
**File:** `src/app/shared/run-status-badge.component.html`
**Action:** Create
Tailwind-only:

```html
<span
  class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
  [class]="style().bg + ' ' + style().text">
  {{ style().label }}
</span>
```

Pill base classes match `docs/ui-specification.md` § Components Badges (`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium`). Per § Accessibility ("Status badges include text label, not color alone") the label is always rendered as text.

### Step 3: `ConfirmModalComponent`
**File:** `src/app/shared/confirm-modal.component.ts`
**Action:** Create
Standalone, `templateUrl`, `styles: []`. Named export `ConfirmModalComponent`.

Public API — used **imperatively** by feature components (e.g. T-018 cancel button) so the call site reads `const ok = await confirm.open({...});`:

```ts
open(opts: {
  title: string;
  body?: string;
  confirmLabel?: string;     // default "Confirm"
  cancelLabel?: string;      // default "Cancel"
  variant?: 'default' | 'danger';  // default 'danger' for cancel-run
}): Promise<boolean>;
```

Internals:
- `private readonly _state = signal<{ visible: boolean; opts: Required<typeof opts>; resolver: (v: boolean) => void } | null>(null);`
- `readonly state = this._state.asReadonly();`
- `open(opts)` returns a new `Promise<boolean>`, stashes resolver in state, sets `visible: true`. After resolve, sets state to `null`.
- `confirm()` calls `state()?.resolver(true)`.
- `cancel()` calls `state()?.resolver(false)`.

Provide as `@Injectable({ providedIn: 'root' })` **service** alongside the visual component? **No** — keep them as one component instance mounted once in the app shell, exposed via a `ModalService` that holds a reference. Concretely:

**File:** `src/app/shared/confirm-modal.service.ts`
**Action:** Create (auxiliary)
Tiny injectable holding the active component reference set by the host component on `ngOnInit`. `ModalService.open(opts)` delegates to the host. This keeps the imperative API ergonomic without forcing every feature to instantiate a portal.

Alternative simpler shape if Angular's CDK is not available: have `ConfirmModalComponent` itself be `providedIn: 'root'`-style by using a top-level `signal` queue similar to `ToastService` (T-011). For v1, keep it simple: ship `ConfirmModalService` as the public API, `ConfirmModalComponent` as the renderer. Mount once in `AppComponent` template.

### Step 4: `ConfirmModalComponent` template + focus trap
**File:** `src/app/shared/confirm-modal.component.html`
**Action:** Create
Tailwind-only modal matching `docs/ui-specification.md` § Components Modals (`max-w-lg`, `rounded-lg`, `shadow-lg`, backdrop `bg-slate-900/50`):

```html
@if (state(); as s) {
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
    role="dialog"
    aria-modal="true"
    [attr.aria-labelledby]="'confirm-title'"
    (click)="onBackdropClick($event)"
    (keydown.escape)="cancel()"
    tabindex="-1"
    #root>
    <div
      class="bg-white rounded-lg shadow-lg max-w-lg w-full p-6"
      (click)="$event.stopPropagation()">
      <h2 id="confirm-title" class="text-lg font-semibold text-slate-900">{{ s.opts.title }}</h2>
      @if (s.opts.body) { <p class="mt-2 text-slate-600">{{ s.opts.body }}</p> }
      <div class="mt-6 flex justify-end gap-2">
        <button
          #cancelBtn
          type="button"
          class="rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          (click)="cancel()">{{ s.opts.cancelLabel }}</button>
        <button
          #confirmBtn
          type="button"
          class="rounded-lg px-4 py-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          [class.bg-red-500]="s.opts.variant === 'danger'"
          [class.hover:bg-red-600]="s.opts.variant === 'danger'"
          [class.bg-sky-500]="s.opts.variant !== 'danger'"
          [class.hover:bg-sky-600]="s.opts.variant !== 'danger'"
          [class.focus-visible:ring-red-500]="s.opts.variant === 'danger'"
          [class.focus-visible:ring-sky-500]="s.opts.variant !== 'danger'"
          (click)="confirm()">{{ s.opts.confirmLabel }}</button>
      </div>
    </div>
  </div>
}
```

Focus trap (in component class):
- On `state()` becoming visible, use an `effect()` to capture the previously focused element (`document.activeElement`) and move focus to `confirmBtn`.
- Add a host listener for `keydown` (`Tab` and `Shift+Tab`): query the rendered modal for `[tabindex], button, input, textarea, select, a[href]`, wrap focus from last → first / first → last.
- On close, restore focus to the previously focused element.
- Escape key handled directly by the template binding `(keydown.escape)="cancel()"` — satisfies AC "closes on Esc".
- Backdrop click handler `onBackdropClick(event)`: only resolves `false` when `event.target === event.currentTarget` (so clicks inside the modal body don't dismiss).

### Step 5: Mount the modal host
**File:** `src/app/app.component.html`
**Action:** Modify
Append `<app-confirm-modal />` to the app shell (alongside `<app-toast-host />` from T-011) so any feature can call `modalService.open(...)` without instantiating a portal.

**File:** `src/app/app.component.ts`
**Action:** Modify
Add `ConfirmModalComponent` to the standalone `imports` array — `CLAUDE.md` "Standalone components only".

### Step 6: Unit tests — badge
**File:** `src/app/shared/run-status-badge.component.spec.ts`
**Action:** Create
For each `RunStatus` value, set the `status` input and assert the rendered text label matches `BADGE_STYLES[status].label`. Assert the documented bg + text class pair per status from `docs/ui-specification.md` § Status Badge Mapping: `running`→`bg-sky-100 text-sky-700`, `paused`→`bg-amber-100 text-amber-700`, `completed`→`bg-emerald-100 text-emerald-700`, `failed`→`bg-red-100 text-red-700`, `cancelled`→`bg-slate-200 text-slate-600`. Per `CLAUDE.md` Testing Conventions, focus on signal-driven behavior; the class assertion here is intentional because the AC names exact classes.

### Step 7: Unit tests — modal
**File:** `src/app/shared/confirm-modal.component.spec.ts`
**Action:** Create
Cases:
- `open({...})` returns a `Promise`; calling `confirm()` resolves it to `true`.
- Calling `cancel()` resolves to `false`.
- `Escape` keydown on the dialog root resolves to `false`.
- Backdrop click resolves to `false`; clicking inside the inner dialog body does not.
- After `open`, focus is on the confirm button. After resolve, focus returns to the previously focused element (use a sentinel button in the test fixture).
- `Tab` on the last focusable element wraps to the first; `Shift+Tab` on the first wraps to the last (focus trap).

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/shared/run-status-badge.component.ts` | Create | Maps `RunStatus`/executor states to modern-minimal pill. |
| `src/app/shared/run-status-badge.component.html` | Create | Tailwind pill with status dot. |
| `src/app/shared/confirm-modal.component.ts` | Create | Imperative `Promise<boolean>` modal with focus trap. |
| `src/app/shared/confirm-modal.component.html` | Create | Modal template with `role="dialog"`, `aria-modal="true"`. |
| `src/app/shared/confirm-modal.service.ts` | Create | Thin wrapper exposing `open(opts)` to feature components. |
| `src/app/app.component.html` | Modify | Mount `<app-confirm-modal />` once in app shell. |
| `src/app/app.component.ts` | Modify | Add `ConfirmModalComponent` to standalone imports. |
| `src/app/shared/run-status-badge.component.spec.ts` | Create | Per-status text + dot color class assertions. |
| `src/app/shared/confirm-modal.component.spec.ts` | Create | Resolve true/false, Esc, backdrop, focus trap. |

## Edge Cases & Risks
- **Multiple concurrent `open()` calls.** v1 contract: only one modal at a time. If a second `open()` arrives while the first is unresolved, reject the second with an error or resolve the first as `false` first. Pick the simpler "second `open` rejects in dev, queues in prod" — for v1, throw in dev and document. Cancel-run is the only caller in FEAT-001 so concurrency won't happen in practice.
- **Focus trap on shadow DOM / portal-less content.** The modal lives in the same DOM tree as the rest of the app shell; focus trap relies on `document.activeElement` and a `querySelectorAll` inside the modal root. No CDK overlay required.
- **Restore focus after destruction.** If the previously focused element is removed from the DOM before the modal closes (rare), focus restoration silently no-ops. Acceptable.
- **`Escape` swallowed by other handlers.** The `(keydown.escape)` binding is on the dialog root element with `tabindex="-1"` and we focus into the modal on open, so the keydown bubbles from the focused button to the dialog handler. If a route component installs its own document-level Esc handler, that may also fire — none currently do. Document.
- **No-CSS rule.** Both components ship `styles: []`; all visual state comes from Tailwind class bindings — `CLAUDE.md` "Tailwind only — no component CSS".

## Acceptance Verification
- [ ] AC "Modal traps focus, closes on Esc, returns a Promise<boolean> (or signal-bound result)" — Step 4 focus-trap implementation + Step 7 spec cases (Esc, focus wrap, resolve true/false).
- [ ] AC "Badge maps each `RunStatus` to the bg/text classes in `docs/ui-specification.md` § Status Badge Mapping" — Step 1 `BADGE_STYLES` mapping + Step 6 spec assertions for all five statuses.
- [ ] AC "Both components ship with styles: [] and templateUrl" — verified at code-review against the `@Component` declarations in Steps 1 and 3 (`CLAUDE.md` Code Style "Separate template files" + "Tailwind only — no component CSS").
- [ ] Convention check: standalone, named exports, signals for state, no NgModules, no component CSS file — `CLAUDE.md` Code Style sections.
