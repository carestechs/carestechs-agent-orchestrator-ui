# Implementation Plan: T-016 — Runs list screen implementation

## Task Reference

- **Task ID:** T-016
- **Type:** Frontend
- **Workflow:** standard (mockup approval gated by upstream T-015)
- **Complexity:** M
- **Dependencies:** T-009 (`RunsService`, `AgentsService`), T-011 (`ToastService` + `FullPageErrorComponent`), T-012 (`StatusBadge`), T-015 (approved `mockups/runs-list.html`)
- **Rationale (from task):** The default-paused view is the operator's primary workspace per the stakeholder definition.

## Overview

Build the standalone `RunsListComponent` at `/runs`. Defaults the status filter to `paused`, lets the operator narrow by `agentRef`, paginates via `?page`, and polls every 5s while the tab is visible. Filter changes round-trip through the URL query string so deep-linking and refresh both work. Errors that the BFF surfaces as `502 upstream-error` (or any `ProblemDetailsError`) render the full-page error component (T-011) with a Retry button. The route sits behind `authGuard` (T-008).

## Implementation Steps

### Step 1: Create the runs-list component class
**File:** `src/app/features/runs-list/runs-list.component.ts`
**Action:** Create

- `@Component({ selector: 'app-runs-list', standalone: true, templateUrl: './runs-list.component.html', styles: [] })` per CLAUDE.md "Standalone components only" + "Separate template files" + "Tailwind only — no component CSS".
- Imports: `RouterLink`, `RunStatusBadgeComponent` (T-012), `FullPageErrorComponent` (T-011), `FormsModule` (for the dropdowns), `DatePipe` if needed for the relative time.
- Inject `RunsService` and `AgentsService` from `src/app/core/` — never `HttpClient` directly (CLAUDE.md "Patterns to Follow: One service per resource").
- Inject `ActivatedRoute`, `Router`, and `DestroyRef`.
- Filter state via signals (CLAUDE.md "Signals for component state"):
  - `status = signal<RunStatus>('paused')` — default per AC-1.
  - `agentRef = signal<string | null>(null)`.
  - `page = signal<number>(1)`.
  - `pageSize = signal<number>(20)` (constant; matches T-009 default).
- Result state:
  - `runs = signal<RunSummary[]>([])`.
  - `pagination = signal<Pagination | null>(null)`.
  - `loading = signal<boolean>(true)`.
  - `error = signal<ProblemDetailsError | null>(null)`.
- Derived state via `computed()`:
  - `query = computed(() => ({ status: this.status(), agentRef: this.agentRef(), page: this.page(), pageSize: this.pageSize() }))`.
  - `sortedRuns = computed(() => [...this.runs()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)))` — `startedAt desc` (task-specific note + AC-1). The orchestrator order is not contractually guaranteed, so we re-sort defensively.
  - `prevDisabled = computed(() => this.page() <= 1)` and `nextDisabled = computed(() => { const p = this.pagination(); return !p || this.page() * this.pageSize() >= p.total; })` — bounds-aware Prev/Next per AC-3 + task-specific note.
- Agents list signal seeded once on init: `agents = signal<Agent[]>([])`.

### Step 2: Bootstrap from URL query, then bridge fetches into signals
**File:** `src/app/features/runs-list/runs-list.component.ts`
**Action:** Modify (continued)

- In the constructor, read the `ActivatedRoute.queryParamMap` once and seed `status`, `agentRef`, `page` (clamping `page` to `>= 1`, falling back to `'paused'` if status is missing). Subsequent navigations that change query params should also seed back via a `queryParamMap` subscription guarded by `takeUntilDestroyed(destroyRef)` (RxJS-only-where-needed per CLAUDE.md "Signals for component state").
- Define a private `load()` method that calls `runsService.list(this.query())`. Use `firstValueFrom` (one-shot) inside an `async` function so loading/error toggles are easy to read; alternatively wire via `toSignal()` if you bind it to a single observable source. Either is acceptable per CLAUDE.md "Use `toSignal()` to bridge observables into templates."
- On success: set `runs`, `pagination`, clear `error`, set `loading=false`.
- On `ProblemDetailsError`: set `error` (the full-page error component will key on it). Do not toast — task-specific note routes `502` (and other terminal failures) to the full-page error path.
- An `effect()` reacting to `query()` re-runs `load()` and pushes the new query to the URL with `router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true })` (task-specific note: "sync filters to URL query string"). Guard the effect against the initial seed echo (e.g., `untracked()` while seeding).

### Step 3: Visibility-gated 5s polling
**File:** `src/app/features/runs-list/runs-list.component.ts`
**Action:** Modify (continued)

Per task-specific note: "poll every 5s gated by `document.visibilityState === 'visible'` with listener cleanup on destroy".

- In `ngOnInit` (or constructor), start an `interval(5000)` from RxJS, `filter(() => document.visibilityState === 'visible')`, `tap(() => this.load())`, piped through `takeUntilDestroyed(destroyRef)` so the subscription dies with the component (CLAUDE.md "Testing Conventions" expects no leaks).
- Also add a `document.addEventListener('visibilitychange', handler)` whose handler triggers an immediate `load()` when `visibilityState` flips back to `'visible'` — without this the user waits up to 5s after refocusing. Remove the listener in a `DestroyRef.onDestroy(() => document.removeEventListener(...))` callback to satisfy the task-specific cleanup requirement.
- Polling must NOT bypass the `loading` flag — keep it silent (do not flicker the skeleton on a poll cycle). Track a separate `polling = signal(false)` flag if needed; the spec asserts the skeleton does not re-appear on poll re-entry.

### Step 4: Create the template
**File:** `src/app/features/runs-list/runs-list.component.html`
**Action:** Create

Tailwind-only markup, modern-minimal tokens (CLAUDE.md "Design System (Modern Minimal)" + `docs/ui-specification.md` § "Screen: Runs List"):

- Page container: `max-w-7xl mx-auto py-8 px-4` (dashboard width).
- Header row: `<h1>` Poppins, `text-slate-900 text-2xl font-semibold`.
- Filter row: status segmented control (All / Running / Paused / Completed / Failed / Cancelled, default Paused) and agentRef dropdown populated from `agents()`. Both use signal setters: `(change)="status.set($event)"`, etc. Changing either calls `page.set(1)` (task-specific note implies pagination resets on filter change is desirable; the AC requires URL sync and re-fetch).
- Body branches with control flow:
  - `@if (error()) { <app-full-page-error [error]="error()!" (retry)="onRetry()" /> }` — `onRetry()` clears `error`, sets `loading=true`, and re-`load()`s. Mapped from task-specific note "surface 502 via the full-page error component (T-011) with Retry".
  - `@else if (loading() && runs().length === 0) { …skeletons… }` — five skeleton rows (`animate-pulse bg-slate-200 rounded h-16`).
  - `@else if (sortedRuns().length === 0) { …empty state… }` — "No runs match this filter." per design system "Empty state".
  - `@else { …table/cards… }` — render `sortedRuns()`. Each row links to `/runs/{{ run.id }}` via `[routerLink]="['/runs', run.id]"`. Show: `<app-run-status-badge [status]="run.status" />`, `agentRef`, truncated `intake.featureBriefPath`, `startedAt` (relative time), `lastStepNumber`. Apply `hover:shadow-md hover:-translate-y-0.5 transition-all duration-200` per design system Cards.
- Pagination footer: Prev / Next buttons, `[disabled]="prevDisabled()"` and `[disabled]="nextDisabled()"` (AC-3). Buttons `rounded-lg`. Click handlers call `page.update(p => p - 1)` and `p + 1`.

### Step 5: Register the lazy route behind `authGuard`
**File:** `src/app/app.routes.ts`
**Action:** Modify

```ts
{
  path: 'runs',
  canMatch: [authGuard],
  loadComponent: () =>
    import('./features/runs-list/runs-list.component').then(m => m.RunsListComponent),
},
```

CLAUDE.md "Lazy routes use `loadComponent`. Never `loadChildren`." `authGuard` comes from T-008. Per the task-specific note, this route is "behind `authGuard` (T-008)".

### Step 6: Component spec
**File:** `src/app/features/runs-list/runs-list.component.spec.ts`
**Action:** Create

Vitest + Angular TestBed. Cover:
- **Default status=paused on initial load:** stub `RunsService.list` and assert it's called with `{ status: 'paused', page: 1, pageSize: 20, agentRef: null }`.
- **`startedAt desc` sort:** seed three runs with out-of-order `startedAt`; assert rendered order is descending.
- **Filter change pushes to URL and re-fetches:** call `component.status.set('running')`, assert `Router.navigate` was invoked with `queryParams: { status: 'running', ... }`, and that `RunsService.list` was re-called.
- **`?page` bounds:** with `meta.total=20, pageSize=20, page=1`, `nextDisabled()` is true; with `page=2, total=21`, `nextDisabled()` is true. With `page=1`, `prevDisabled()` is true.
- **Polling gate:** mock `document.visibilityState` getter to return `'hidden'` and tick 5s; assert `RunsService.list` is NOT called again. Flip to `'visible'` and dispatch `visibilitychange`; assert it IS called.
- **Polling cleanup:** destroy the fixture, advance 10s; assert no further `RunsService.list` calls and no `visibilitychange` listener remains (use a spy on `document.removeEventListener`).
- **`502` → full-page error:** stub `runsService.list` to reject with `ProblemDetailsError({ status: 502, code: 'upstream-error' })`. Assert `<app-full-page-error>` is in the DOM and `<table>`/cards are not. Click Retry, restore the stub to resolve, assert the list renders.

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `src/app/features/runs-list/runs-list.component.ts` | Create | Standalone component, signals state, polling, URL sync, calls `RunsService`/`AgentsService`. |
| `src/app/features/runs-list/runs-list.component.html` | Create | Tailwind-only template, status filter, agent dropdown, sortable table, pagination, full-page error branch. |
| `src/app/features/runs-list/runs-list.component.spec.ts` | Create | Tests for default filter, sort, URL sync, bounds, visibility-gated polling, cleanup, error path. |
| `src/app/app.routes.ts` | Modify | Register `/runs` lazy route behind `authGuard`. |

## Edge Cases & Risks

- **URL ↔ signal feedback loop:** the `effect()` that pushes `query()` to the URL will fire when `queryParamMap` updates the signals from a back/forward navigation. Use `queryParamsHandling: 'merge', replaceUrl: true` and gate the effect with `untracked()` during initial seeding to avoid an infinite ping-pong.
- **Polling races with manual filter change:** if a poll fires mid-edit, the response may overwrite the user's freshly-changed filter view. Track a request-id (monotonic counter) and ignore late responses whose id is below the current. Implement inside the service or component — keeping it in the component is fine for v1.
- **Tab backgrounded for hours:** when the user returns, `visibilitychange` fires and we want one immediate `load()`, then the 5s cadence resumes. Handler does both: trigger `load()` and let the `interval` keep ticking (it never stopped, just got filtered).
- **`agents()` empty:** the agentRef dropdown should show "All agents" as the default option and tolerate the agents fetch failing — log and leave dropdown disabled, do not block the runs table.
- **`401 unauthenticated` mid-poll:** handled centrally by `ApiClient` (T-007) emitting the auth-expired signal which `AuthService` (T-008) catches; the runs component does not need its own logic, but the spec should not assert toast behavior here.
- **Pagination overrun:** if a poll arrives that shrinks `total` below `(page-1)*pageSize`, the user's current page can become empty. Detect `runs.length === 0 && page() > 1` and auto-step `page` back to 1 (or `Math.ceil(total/pageSize)`).
- **`502` Retry that fails again:** Retry simply re-runs `load()`; if the upstream is still down, the full-page error re-renders. No exponential backoff in v1.

## Acceptance Verification

- [ ] **AC-1 — Initial load shows paused runs sorted by `startedAt desc`:** Spec cases "Default status=paused on initial load" and "`startedAt desc` sort".
- [ ] **AC-2 — Status filter and agentRef filter update query string and refetch:** Spec case "Filter change pushes to URL and re-fetches" plus the URL-sync `effect()`.
- [ ] **AC-3 — Pagination uses `?page` and disables Prev/Next at bounds:** Spec case "`?page` bounds" and the `prevDisabled()` / `nextDisabled()` `computed()`s wired into the template.
- [ ] **AC-4 — Polling pauses when `document.visibilityState !== 'visible'` and resumes on focus:** Spec case "Polling gate" + the `visibilitychange` immediate-trigger handler.
- [ ] **AC-5 — Network/`502` errors surface the full-page error component with Retry:** Spec case "`502` → full-page error".
- [ ] **AC-6 — Component spec covers signal-driven re-render on filter change and polling start/stop:** Covered by the filter-change and polling-cleanup specs.
