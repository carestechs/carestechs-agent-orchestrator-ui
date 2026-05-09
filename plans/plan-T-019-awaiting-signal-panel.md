# Implementation Plan: T-019 — Run detail — awaiting-signal panel and submit

## Task Reference

- **Task ID:** T-019
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** M
- **Dependencies:** T-009 (`SignalsService`, `RunsService`), T-010 (`TraceStreamService`), T-018 (`RunDetailComponent` host with awaiting-signal slot)
- **Rationale (from task):** Core of the v1 critical path — the signal submission is what replaces `curl + jq`.

## Overview

Add the `AwaitingSignalPanelComponent` that derives the "awaiting human dispatch" state from the live trace, pre-fills `taskId` (read-only when one match, picker when multiple), renders the signal form, and submits via `SignalsService` (T-009). On `202` it shows a success toast — "Signal already received" when `meta.alreadyReceived` is true. Per-error handling: `404 task-not-in-run-memory` → inline error on `taskId` with a re-pick hint; `422 invalid-signal-payload` → inline per-field errors keyed off `ProblemDetails.errors`; `409 run-already-terminal` → toast plus run refresh. No client-side dedupe — the operator is free to resubmit.

## Implementation Steps

### Step 1: Create the panel component class
**File:** `src/app/features/run-detail/awaiting-signal-panel.component.ts`
**Action:** Create

- `@Component({ selector: 'app-awaiting-signal-panel', standalone: true, templateUrl: './awaiting-signal-panel.component.html', styles: [] })` per CLAUDE.md "Standalone components only" + "Separate template files" + "Tailwind only — no component CSS".
- Imports: `ReactiveFormsModule` (for `FormGroup`), `FormsModule` if any `ngModel` usage.
- Inputs (signal inputs preferred):
  - `runId = input.required<string>()`.
  - `traceRecords = input.required<TraceRecord[]>()` — the panel does NOT subscribe to `TraceStreamService` directly; the host (`RunDetailComponent` from T-018) passes its existing trace signal in. This avoids two stream consumers per CLAUDE.md "do not duplicate state" and enforces the task-specific note "derive the awaiting state with `computed()` over the trace signal".
  - `runStatus = input.required<RunStatus>()` — used to hide the form when terminal (defensive even though terminal usually clears the awaiting record).
- Output: `runRefreshRequested = output<void>()` — emitted on `409` so the host re-fetches via `RunsService.get` (the panel does not own header state).
- Inject `SignalsService` (T-009), `ToastService` (T-011).

### Step 2: Derive awaiting state via `computed()`
**File:** `src/app/features/run-detail/awaiting-signal-panel.component.ts`
**Action:** Modify (continued)

Per task-specific note: "find latest `executor_call` with `state=dispatched, mode=human`".

- `awaitingDispatches = computed<ExecutorCallRecord[]>(() => {
    const records = this.traceRecords();
    return records.filter(r => r.kind === 'executor_call' && r.state === 'dispatched' && r.mode === 'human') as ExecutorCallRecord[];
  });`
- `latestDispatch = computed(() => {
    const list = this.awaitingDispatches();
    if (list.length === 0) return null;
    return [...list].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  });`
- `prefilledTaskIds = computed<string[]>(() => {
    const ids = new Set<string>();
    for (const r of this.awaitingDispatches()) {
      const id = (r.intake as Record<string, unknown>)['taskId'];
      if (typeof id === 'string') ids.add(id);
    }
    return [...ids];
  });`
- `formVisible = computed(() => this.runStatus() === 'paused' && this.latestDispatch() !== null);`
  Per AC-1 ("Form is hidden when no `executor_call` in dispatched-human state exists") and the host T-018 keeps the panel mounted but hidden via this gate.
- `taskIdMode = computed<'single' | 'picker'>(() => this.prefilledTaskIds().length > 1 ? 'picker' : 'single');`
  Per AC-2 ("`taskId` pre-fills … read-only when one match, picker when multiple"). Cite task-specific note: "pre-fill `taskId` (read-only when one match, picker when multiple)".

### Step 3: Form definition and field error map
**File:** `src/app/features/run-detail/awaiting-signal-panel.component.ts`
**Action:** Modify (continued)

- Use `FormGroup` (Reactive Forms) — easier mapping for `ProblemDetails.errors` (per-field).
- Fields:
  - `taskId: FormControl<string>` — required; disabled when `taskIdMode() === 'single'` (read-only display); enabled `<select>` when `'picker'`.
  - `commitSha: FormControl<string>` — required; pattern `^[0-9a-f]{7,40}$` (per `docs/ui-specification.md` Signal form fields table).
  - `prUrl: FormControl<string>` — required; URL validator (must be `https://`).
  - `diff: FormControl<string>` — optional.
  - `implementationNotes: FormControl<string>` — optional.
- An `effect()` that watches `latestDispatch()` and `taskIdMode()` and seeds `taskId`:
  - `single` → `setValue(prefilledTaskIds()[0])` and `disable()`.
  - `picker` → `enable()`, leave value as the first id (operator can change it).
- `submitting = signal<boolean>(false);`
- `fieldErrors = signal<Record<string, string[]>>({});` — populated on `422` from `ProblemDetails.errors`.
- `taskIdError = signal<string | null>(null);` — populated on `404 task-not-in-run-memory`.

### Step 4: Submit method with full error mapping
**File:** `src/app/features/run-detail/awaiting-signal-panel.component.ts`
**Action:** Modify (continued)

```ts
async onSubmit(): Promise<void> {
  if (this.submitting()) return;          // No client-side dedupe; just no double-fire.
  if (this.form.invalid) { this.form.markAllAsTouched(); return; }

  this.submitting.set(true);
  this.fieldErrors.set({});
  this.taskIdError.set(null);

  const { taskId, commitSha, prUrl, diff, implementationNotes } = this.form.getRawValue();
  const body: SignalRequest = {
    name: 'implementation-complete',
    taskId,
    payload: { commitSha, prUrl, ...(diff ? { diff } : {}), ...(implementationNotes ? { implementationNotes } : {}) },
  };

  try {
    const { data, meta } = await firstValueFrom(this.signalsService.submit(this.runId(), body));
    this.toastService.success(meta?.alreadyReceived ? 'Signal already received' : 'Signal received');
    this.form.patchValue({ commitSha: '', prUrl: '', diff: '', implementationNotes: '' });
  } catch (err) {
    if (err instanceof ProblemDetailsError) {
      switch (err.code) {
        case 'task-not-in-run-memory': // HTTP 404
          this.taskIdError.set('This task is no longer awaiting a signal — re-pick from the trace.');
          break;
        case 'invalid-signal-payload': // HTTP 422
          this.fieldErrors.set(err.errors ?? {});
          break;
        case 'run-already-terminal': // HTTP 409
          this.toastService.info('This run is already terminal.');
          this.runRefreshRequested.emit();
          break;
        default:
          this.toastService.error(err.title);
      }
    } else {
      this.toastService.error('Could not submit signal. Try again.');
    }
  } finally {
    this.submitting.set(false);
  }
}
```

Locks every task-specific note: success toast text branches on `meta.alreadyReceived`, `404` → inline `taskId` error, `422` → inline per-field errors, `409` → toast + refresh, no retry on `409`, no client-side dedupe (we always send when the user clicks Submit and the form is valid).

CLAUDE.md "Idempotent retries. All write endpoints are idempotent; let the user retry freely. Do not dedupe client-side." — exactly this behavior.

### Step 5: Create the template
**File:** `src/app/features/run-detail/awaiting-signal-panel.component.html`
**Action:** Create

Tailwind-only, modern-minimal tokens:

- Card wrapper `bg-white rounded-lg shadow-sm p-6` — elevated card.
- `@if (!formVisible()) {}` early branch:
  - When `runStatus() !== 'paused'` or there are no awaiting dispatches: render nothing (host can show a status banner if desired).
- `@else` block:
  - Heading: `<h2 class="font-[Poppins] text-slate-900 text-lg font-semibold">Awaiting signal</h2>`.
  - Form `[formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-4 mt-4"`.
  - **Task ID** field:
    - `taskIdMode() === 'single'` → `<input type="text" formControlName="taskId" readonly class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">`.
    - `taskIdMode() === 'picker'` → `<select formControlName="taskId" class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"> @for (id of prefilledTaskIds(); track id) { <option [value]="id">{{ id }}</option> } </select>`.
    - Inline error: `@if (taskIdError()) { <p class="text-red-600 text-sm">{{ taskIdError() }}</p> }`. Plus `@if (fieldErrors()['taskId']) { @for (msg of fieldErrors()['taskId']; track msg) { <p class="text-red-600 text-sm">{{ msg }}</p> } }`.
  - **Commit SHA** input — required, hex pattern hint. Render `fieldErrors()['commitSha']` as inline messages.
  - **PR URL** input `type="url"` — required. Render `fieldErrors()['prUrl']` inline.
  - **Diff** textarea (`rows="6"`, `font-mono text-xs`).
  - **Implementation notes** textarea (`rows="3"`).
  - Submit button: `class="rounded-lg bg-sky-500 hover:bg-sky-600 active:translate-y-px text-white px-4 py-2 disabled:opacity-50"`, `[disabled]="submitting() || form.invalid"`. Inline spinner when `submitting()`.

All inputs use design-system classes per CLAUDE.md "Design System (Modern Minimal)" and `docs/ui-specification.md` § "Forms".

### Step 6: Embed the panel into `RunDetailComponent`
**File:** `src/app/features/run-detail/run-detail.component.html`
**Action:** Modify

Replace the placeholder slot (left by T-018) with:

```html
<app-awaiting-signal-panel
  [runId]="runId()"
  [traceRecords]="trace()"
  [runStatus]="run()?.status ?? 'running'"
  (runRefreshRequested)="onRefreshRun()"
/>
```

**File:** `src/app/features/run-detail/run-detail.component.ts`
**Action:** Modify

- Add `AwaitingSignalPanelComponent` to the component imports array.
- Add `onRefreshRun()` method: `this.run.set(null); firstValueFrom(this.runsService.get(this.runId())).then(r => this.run.set(r));` — used by the panel's `runRefreshRequested` output on `409`. This is the same refresh path the cancel-`409` arm uses; consider extracting a shared `refreshRun()` private method.

### Step 7: Component spec
**File:** `src/app/features/run-detail/awaiting-signal-panel.component.spec.ts`
**Action:** Create

Vitest + TestBed. Cover:
- **Form hidden with no awaiting dispatch:** pass empty `traceRecords` and `runStatus='running'`; assert no `<form>` is in the DOM.
- **Form visible on paused + awaiting human dispatch:** seed one `executor_call(state=dispatched, mode=human, intake={ taskId: 'T-001' })`, `runStatus='paused'`; assert form renders, `taskId` input has value `T-001`, and is read-only (CLAUDE.md "Patterns to Follow" + AC-2).
- **Picker when multiple awaiting dispatches:** seed two dispatches with distinct `taskId`s (`T-001`, `T-002`); assert a `<select>` with both options renders, the form is enabled, and changing the select updates the form value.
- **Successful submit:** stub `SignalsService.submit` to resolve `{ data: <SignalReceipt>, meta: null }`; click Submit; assert `toastService.success` called with `'Signal received'` and `commitSha`/`prUrl`/`diff`/`notes` controls are cleared (`taskId` retained per AC-2).
- **`meta.alreadyReceived` toast text:** stub to resolve `{ data, meta: { alreadyReceived: true } }`; assert `toastService.success` called with `'Signal already received'`.
- **`404 task-not-in-run-memory`:** stub `submit` to reject with `ProblemDetailsError({ status: 404, code: 'task-not-in-run-memory' })`; assert `taskIdError()` is set and rendered with the "re-pick" copy; assert no toast.
- **`422 invalid-signal-payload`:** stub to reject with `ProblemDetailsError({ status: 422, code: 'invalid-signal-payload', errors: { commitSha: ['must be hex'], prUrl: ['must be https'] } })`; assert both messages render under their fields; assert no toast.
- **`409 run-already-terminal`:** stub to reject with `code: 'run-already-terminal'`; assert `toastService.info` called and `runRefreshRequested` emitted exactly once. Assert `signalsService.submit` was called once (no auto-retry — task-specific note).
- **No client-side dedupe:** call `onSubmit()` twice in a row with the same body, both completing; assert `signalsService.submit` was called twice (CLAUDE.md "Idempotent retries").
- **Submit guard during in-flight:** while a slow submit is pending, click Submit again; assert the second click is a no-op (only one inflight call) — distinct from dedupe; this is the in-flight guard.

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `src/app/features/run-detail/awaiting-signal-panel.component.ts` | Create | Standalone component, `computed()`-derived awaiting state, signal form, error mapping, no client-side dedupe. |
| `src/app/features/run-detail/awaiting-signal-panel.component.html` | Create | Tailwind-only template, single/picker `taskId`, per-field validation messages, success/inline-error states. |
| `src/app/features/run-detail/awaiting-signal-panel.component.spec.ts` | Create | Tests for visibility, prefill, picker, submit success/already-received, 404/422/409 mapping, no dedupe. |
| `src/app/features/run-detail/run-detail.component.html` | Modify | Replace the awaiting-signal slot with `<app-awaiting-signal-panel>` and wire its inputs/outputs. |
| `src/app/features/run-detail/run-detail.component.ts` | Modify | Import the panel; add `onRefreshRun()` (or share `refreshRun()`) to handle the panel's `runRefreshRequested` output. |

## Edge Cases & Risks

- **Multiple awaiting dispatches with the same `taskId`:** the picker should de-duplicate (the `Set` in `prefilledTaskIds()` already does). Operator sees one entry per unique id.
- **Awaiting dispatch disappears mid-edit:** if the trace stream pushes a `state=completed` for the same node before the operator submits, `awaitingDispatches()` becomes empty and `formVisible()` flips to false — losing the operator's typed-in `commitSha`/`prUrl`. Acceptable in v1 (the run advanced); consider preserving the fields in a future polish but do not gate AC on it.
- **`ExecutorCallRecord.intake` shape:** `intake` is `Record<string, unknown>`. Reading `intake['taskId']` and narrowing via `typeof === 'string'` is mandatory (CLAUDE.md "TypeScript & Angular: No `any`").
- **`422` error payload missing `errors` map:** `ProblemDetails.errors` is optional. When absent, fall back to a single inline error showing `ProblemDetails.detail` or `title`. The spec should include a case for this fallback.
- **`commitSha` regex strictness:** `^[0-9a-f]{7,40}$` — uppercase hex from some tooling will be rejected client-side. The orchestrator's authoritative validator may differ; if `422` says it accepts uppercase, relax to `[0-9a-fA-F]{7,40}`. Defer to the orchestrator's behavior in case of conflict.
- **Signal name hard-coded:** v1 accepts only `'implementation-complete'` per `docs/data-model.md` `SignalName`. If the orchestrator adds new names, this panel needs a name input. Out of scope.
- **Submit while stream is reconnecting:** the panel doesn't depend on stream state to submit. The success toast will appear; the reconnected stream will then yield the run-advance records. Spec doesn't need to assert this directly.
- **Test for "no client-side dedupe" vs "submit guard":** these are distinct. The dedupe-test runs Submit, awaits, runs Submit again — both reach the network. The in-flight-guard test runs Submit, then Submit again before the first promise settles — only one call goes out. Keep both cases to lock in the behavior.

## Acceptance Verification

- [ ] **AC-1 — Form is hidden when no `executor_call` in dispatched-human state exists:** Spec case "Form hidden with no awaiting dispatch" + the `formVisible()` `computed()`.
- [ ] **AC-2 — `taskId` pre-fills from latest matching dispatch and is read-only (picker when multiple):** Spec cases "Form visible on paused + awaiting human dispatch" and "Picker when multiple awaiting dispatches".
- [ ] **AC-3 — Successful submit shows toast "Signal received" (or "Signal already received" when `meta.alreadyReceived`):** Spec cases "Successful submit" and "`meta.alreadyReceived` toast text".
- [ ] **AC-4 — Error mapping `404 → inline error on taskId with re-pick hint`, `422 → inline errors per field`, `409 → toast + run refresh`:** Spec cases for each of the three error codes.
- [ ] **AC-5 — No client-side dedupe; operator can resubmit freely:** Spec case "No client-side dedupe" asserts two network calls for two clicks.
- [ ] **Task-specific note — derive awaiting state with `computed()` over the trace signal; do not duplicate state:** verified by code review of `awaitingDispatches()` + `latestDispatch()` + the panel taking `traceRecords` as an input rather than re-subscribing to `TraceStreamService`.
