# Implementation Plan: T-018 — Run detail screen — header, trace timeline, cancel

## Task Reference

- **Task ID:** T-018
- **Type:** Frontend
- **Workflow:** standard (mockup approval gated by upstream T-017)
- **Complexity:** L
- **Dependencies:** T-009 (`RunsService`), T-010 (`TraceStreamService`), T-011 (`ToastService`), T-012 (`ConfirmModalComponent`, `RunStatusBadgeComponent`), T-017 (approved `mockups/run-detail.html`)
- **Rationale (from task):** Realizes the AC "trace begins streaming within 1s" and "Cancelling a run sets status to cancelled after confirmation".

## Overview

Build the standalone `RunDetailComponent` at `/runs/:id`. On init it fetches the run header via `RunsService.get(id)` and opens the live NDJSON tail via `TraceStreamService` (T-010) with `follow=true`. The header carries a Cancel button that opens a `<app-confirm-modal>` (T-012); on confirm, it calls `RunsService.cancel(id)`. The trace timeline visually distinguishes the five `TraceRecord.kind` variants. On destroy, the trace stream is aborted. The screen is wired so T-019 can attach the awaiting-signal panel without further structural change.

## Implementation Steps

### Step 1: Create the run-detail component class
**File:** `src/app/features/run-detail/run-detail.component.ts`
**Action:** Create

- `@Component({ selector: 'app-run-detail', standalone: true, templateUrl: './run-detail.component.html', styles: [] })` — CLAUDE.md "Standalone components only" + "Separate template files" + "Tailwind only — no component CSS".
- Imports: `RouterLink`, `RunStatusBadgeComponent` (T-012), `ConfirmModalComponent` (T-012), `DatePipe`. The `AwaitingSignalPanelComponent` from T-019 is added later — leave a placeholder slot in the template now.
- Inject `ActivatedRoute`, `Router`, `RunsService`, `TraceStreamService`, `ToastService`, `DestroyRef`. Components consume services per CLAUDE.md "Patterns to Follow".
- State signals (CLAUDE.md "Signals for component state"):
  - `runId = signal<string>('')`.
  - `run = signal<RunDetail | null>(null)`.
  - `runLoading = signal<boolean>(true)`.
  - `runError = signal<ProblemDetailsError | null>(null)`.
  - `traceRecords` — owned by `TraceStreamService` and re-exposed (`readonly trace = traceStreamService.records;` or similar) so the template can render `trace()` directly.
  - `connectionState = traceStreamService.state` (`'connecting' | 'streaming' | 'closed' | 'error'` per `docs/ui-specification.md` § "Behavior: Trace Stream").
  - `cancelling = signal<boolean>(false)`.
  - `confirmOpen = signal<boolean>(false)`.
- Derived `computed()`:
  - `isTerminal = computed(() => { const r = this.run(); return !!r && (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled'); })` — drives Cancel button visibility (task-specific note: "Cancel hidden when run is terminal").
  - `groupedTrace = computed(() => groupTraceByStep(this.trace()))` — pure helper grouping by `stepNumber` for the timeline (per `docs/ui-specification.md` "vertical list of step groups").

### Step 2: Wire init: load header, open stream, abort on destroy
**File:** `src/app/features/run-detail/run-detail.component.ts`
**Action:** Modify (continued)

- In the constructor (or `ngOnInit`), read `runId` from `ActivatedRoute.paramMap` and `set` the signal.
- `RunsService.get(runId())` — bridge with `firstValueFrom`, set `run`, clear `runError`, set `runLoading=false`. On `ProblemDetailsError`, set `runError` (the template renders an inline error state).
- Open the trace stream: `traceStreamService.open(runId(), { follow: true })`. The service (T-010) owns its own `AbortController` internally; expose an `abort()` method on the service that the component calls in a `DestroyRef.onDestroy(...)`. Per CLAUDE.md anti-patterns "No WebSockets / SSE for the trace" — `TraceStreamService` uses `fetch` + `ReadableStream`.
- `DestroyRef.onDestroy(() => traceStreamService.abort())` — satisfies AC-4 ("unsubscribes/aborts the trace stream on destroy") and the task-specific note "abort it on destroy".

### Step 3: Cancel flow with confirmation modal
**File:** `src/app/features/run-detail/run-detail.component.ts`
**Action:** Modify (continued)

- `onCancelClick()`: `confirmOpen.set(true)`.
- `onCancelConfirmed()`:
  1. `confirmOpen.set(false)`; `cancelling.set(true)`.
  2. `await firstValueFrom(runsService.cancel(this.runId()))`.
  3. On success: replace `run.set(updatedSummary)` (the cancel response carries the updated `RunSummary`; cast to `RunDetail` carefully — only header-relevant fields change so a partial merge `{ ...run()!, ...updated }` works).
  4. On `ProblemDetailsError`: if `code === 'run-already-terminal'` (HTTP 409), call `toastService.info('This run is already terminal.')` AND re-fetch the run via `RunsService.get(id)` to refresh the header. Do NOT retry the cancel (task-specific note: "`409 run-already-terminal` → toast + refresh, no retry").
  5. For any other error: `toastService.error(error.title)` and stay on the page.
  6. Always `cancelling.set(false)`.
- `onCancelDeclined()`: `confirmOpen.set(false)` — no service call.

### Step 4: Create the template
**File:** `src/app/features/run-detail/run-detail.component.html`
**Action:** Create

Tailwind-only, modern-minimal tokens, layout per `docs/ui-specification.md` § "Screen: Run Detail":

- Outer wrapper `max-w-7xl mx-auto py-8 px-4`.
- Header strip:
  - Back link `<a routerLink="/runs" class="text-sky-700 hover:underline">← Runs</a>`.
  - Run id (truncated), `<app-run-status-badge [status]="run()?.status ?? 'running'" />`, agentRef, `intake.featureBriefPath`, `startedAt`, `currentNode` — only when `run()` is set; show skeleton bars otherwise (`animate-pulse bg-slate-200 rounded`).
  - Cancel button: `@if (!isTerminal()) { <button (click)="onCancelClick()" [disabled]="cancelling()" class="rounded-lg bg-red-500 hover:bg-red-600 text-white px-4 py-2 disabled:opacity-50">Cancel run</button> }` — danger variant per design system.
- Two-column body on `lg:` (`grid grid-cols-1 lg:grid-cols-3 gap-8`):
  - Left (`lg:col-span-2`) — trace timeline `max-w-5xl` reading width inside.
  - Right (`lg:col-span-1`) — slot for `<app-awaiting-signal-panel>` (T-019). For T-018 leave a comment marker `<!-- awaiting-signal-panel inserted by T-019 -->` so T-019's only structural change is one element.
- Trace timeline:
  - `aria-live="polite"` on the wrapping `<ol>` per `docs/ui-specification.md` accessibility note.
  - Iterate `groupedTrace()` rendering each step group; inside each, iterate the records.
  - Per-record rendering must visually distinguish the five `kind` values (task-specific note: "visually distinguish the 5 trace `kind` values"):
    - `step` — slate icon, `text-slate-700`, label "Step <n>: <nodeName>".
    - `executor_call` — sky border-l (mode `local`/`remote`/`engine`), violet border-l for `mode='human'`, plus a state pill (`dispatched` amber, `completed` emerald, `failed` red) reusing `<app-run-status-badge>` per the dual-purpose note in `docs/ui-specification.md`.
    - `policy_call` — slate-50 surface, "LLM call" caption with `provider`/`model`/`latencyMs`.
    - `webhook_event` — violet accent, "Webhook" caption with `source`.
    - `effector_call` — sky-100 chip, "Effector" caption with `effector`.
  - Empty trace state while `connectionState() === 'connecting'`: a single skeleton row.
  - `connectionState() === 'error'` banner above the timeline: `bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 text-sm` with a "Reconnect" button calling `traceStreamService.open(runId(), { follow: true, since: ... })` per `docs/ui-specification.md` "Stream error" state.
- Confirmation modal:
  ```html
  <app-confirm-modal
    [open]="confirmOpen()"
    title="Cancel this run?"
    message="The run will stop and cannot be resumed."
    confirmLabel="Cancel run"
    confirmVariant="danger"
    (confirm)="onCancelConfirmed()"
    (cancel)="onCancelDeclined()"
  />
  ```
  Modal is the T-012 component; satisfies the task-specific note "render `<app-confirm-modal>` (T-012) before cancel".

### Step 5: Group helper for the timeline
**File:** `src/app/features/run-detail/group-trace-by-step.ts`
**Action:** Create

Pure function `groupTraceByStep(records: TraceRecord[]): StepGroup[]` where `StepGroup = { stepNumber: number; records: TraceRecord[] }`. Stable order — return groups by descending `stepNumber` so the latest activity is at the top (matches the mockup). Functional composition per CLAUDE.md "Functional composition over classes".

Co-located unit-test `group-trace-by-step.spec.ts`: empty input → `[]`; mixed records across two steps → two groups in `desc` order; records within a group preserve insertion order.

### Step 6: Register the lazy route
**File:** `src/app/app.routes.ts`
**Action:** Modify

```ts
{
  path: 'runs/:id',
  canMatch: [authGuard],
  loadComponent: () =>
    import('./features/run-detail/run-detail.component').then(m => m.RunDetailComponent),
},
```

CLAUDE.md "Lazy routes use `loadComponent`. Never `loadChildren`." Order matters — register after `runs/new` if/when that exists, before the catch-all.

### Step 7: Component spec
**File:** `src/app/features/run-detail/run-detail.component.spec.ts`
**Action:** Create

Vitest + TestBed. Cover:
- **Header load:** stub `RunsService.get` to resolve; assert run header renders.
- **Trace stream opens with `follow=true`:** spy on `TraceStreamService.open`; assert it is called with `(runId, { follow: true })` exactly once on init.
- **First record paints quickly:** mocked `TraceStreamService.records` signal emits one record; assert it is rendered (the AC "within 1s" is observed end-to-end in T-020 E2E; the unit test verifies the rendering pipeline is signal-driven).
- **All five kinds render distinctly:** seed records of each `kind`; assert each row carries the kind-specific class/marker.
- **Cancel hidden when terminal:** with `run.status='completed'`, assert the Cancel button is absent (`isTerminal()` true).
- **Confirm modal flow:** click Cancel → `confirmOpen()` true and modal in DOM; click Cancel-decline → modal closes, `RunsService.cancel` not called; click Cancel-confirm → `RunsService.cancel(runId)` called once.
- **`409 run-already-terminal`:** stub `runsService.cancel` to reject with `ProblemDetailsError({ status: 409, code: 'run-already-terminal' })`. Assert `ToastService.info` was called and `RunsService.get` was re-called to refresh; assert no second `cancel` invocation (no retry).
- **Abort on destroy:** spy on `TraceStreamService.abort`; destroy fixture; assert called once.
- **Reconnect on transient drop:** drive `TraceStreamService.state` to `'error'`, assert the inline reconnect banner; click Reconnect; assert `open` called again with a `since` argument.

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `src/app/features/run-detail/run-detail.component.ts` | Create | Standalone component, header + trace + cancel, signals state, calls `RunsService` and `TraceStreamService`. |
| `src/app/features/run-detail/run-detail.component.html` | Create | Tailwind template, header, two-column layout with awaiting-signal slot, kind-distinguished trace rows, confirm modal. |
| `src/app/features/run-detail/run-detail.component.spec.ts` | Create | Tests for header load, stream open/abort, cancel flow, 409 path, reconnect, terminal hides Cancel. |
| `src/app/features/run-detail/group-trace-by-step.ts` | Create | Pure step-grouping helper. |
| `src/app/features/run-detail/group-trace-by-step.spec.ts` | Create | Unit test for grouping. |
| `src/app/app.routes.ts` | Modify | Register `/runs/:id` lazy route behind `authGuard`. |

## Edge Cases & Risks

- **Trace records arriving before the header:** the stream may yield its first record before `RunsService.get` resolves. Render the timeline as soon as records exist; do not block on the header. The skeleton state shows for header only.
- **`TraceStreamService` reconnect:** on transient drop the service emits `state='error'` and (per T-010) auto-retries once with `since=<lastTimestamp>`. The component shows an inline banner only when the service finally surrenders — bind to the state signal, not to retry counts.
- **Cancel button double-fire:** `cancelling()` flag plus the `[disabled]` binding prevent re-entry. Spec asserts a single `cancel()` call.
- **`409` after Cancel was confirmed but the run finished naturally:** the toast says "already terminal" and the refreshed run header reflects the actual terminal status (could be `completed`, not necessarily `cancelled`). Do NOT show a retry CTA — the user has nothing to retry.
- **Memory growth on long-running streams:** `TraceStreamService` keeps the rolling array. T-010 owns the cap (e.g., last N records) — the component just renders. Do not duplicate state in the component (CLAUDE.md "do not duplicate state").
- **Route param change without component re-creation:** if Angular reuses the component when `:id` changes (it normally does not for `loadComponent` routes, but be explicit), abort the current stream and re-init. Reading the param via `paramMap` subscription with `takeUntilDestroyed` handles this.
- **`runError` on header fetch:** treat `404 run-not-found` as a friendly empty-state ("Run not found.") with a back link; other errors fall through to the toast service.
- **AwaitingSignalPanel coupling:** keep the slot a plain element marker in T-018; importing the panel here would couple T-018 to T-019. T-019 inserts the import + element.

## Acceptance Verification

- [ ] **AC-1 — First trace record paints within 1s of route load:** Spec case "First record paints quickly" verifies the rendering pipeline is signal-driven (no debounce, no buffering); end-to-end timing is locked by the T-020 E2E spec.
- [ ] **AC-2 — Cancel button hidden when run is terminal; confirmation modal returns control if the operator declines:** Spec cases "Cancel hidden when terminal" and the "Confirm modal flow" decline branch.
- [ ] **AC-3 — Cancel `409 run-already-terminal` shows a toast and refreshes the run; never retries:** Spec case "`409 run-already-terminal`".
- [ ] **AC-4 — Component unsubscribes/aborts the trace stream on destroy:** Spec case "Abort on destroy".
- [ ] **AC-5 — Spec covers terminal state (no Cancel, no signal form), running state (no signal form), reconnect on transient drop:** Spec cases "Cancel hidden when terminal" + "Reconnect on transient drop". (Signal-form absence on running is a T-019 concern but the slot is empty here by construction.)
- [ ] **Task-specific note — distinguishes 5 trace `kind` values visually:** Spec case "All five kinds render distinctly".
