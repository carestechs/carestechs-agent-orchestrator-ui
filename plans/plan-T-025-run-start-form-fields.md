# Implementation Plan: T-025 — Agent picker + intake JSON editor with client-side validation

## Task Reference

- **Task ID:** T-025
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** M
- **Dependencies:** T-024 (component scaffold + model + CTAs)
- **Rationale (from task):** Covers the AC: agent picker loads agents; malformed JSON is caught before submit; submit is gated on client validity. Pure form work, no network beyond the existing `AgentsService.list()`.

## Overview

Flesh out `RunStartComponent`'s form: a select bound to `AgentsService.list()` results, a monospace `<textarea>` for intake JSON with a debounced `JSON.parse` validator and inline error, an optional positive-integer `maxSteps` input, a "Format" button that pretty-prints the intake on demand, and an empty-state for zero registered agents with a refresh affordance. No HTTP submit yet — that lands in T-026.

## Implementation Steps

### Step 1: Add a refresh affordance to `AgentsService`
**File:** `src/app/core/agents.service.ts`
**Action:** Modify

- The current `list()` returns a fresh observable on every call (no in-memory cache), so a literal "refresh" is just calling `list()` again. Document this with a one-line comment so future-callers don't add a cache without thinking.
- No code change needed beyond the comment unless we discover a memoization layer during implementation; if found, expose an explicit `refresh()` that bypasses it.

### Step 2: Create the intake JSON validator
**File:** `src/app/features/run-start/intake-json.validator.ts`
**Action:** Create

```ts
import type { ValidatorFn } from '@angular/forms';

export interface IntakeJsonResult {
  valid: boolean;
  parsed?: Record<string, unknown>;
  error?: string;
}

export function parseIntake(raw: string): IntakeJsonResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { valid: false, error: 'Intake is required.' };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: 'Intake must be a JSON object.' };
    }
    return { valid: true, parsed: parsed as Record<string, unknown> };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

export const intakeJsonValidator: ValidatorFn = (ctrl) => {
  const value = typeof ctrl.value === 'string' ? ctrl.value : '';
  const r = parseIntake(value);
  return r.valid ? null : { intakeJson: r.error ?? 'Invalid JSON' };
};
```

- Pure function exported alongside the `ValidatorFn` so tests can exercise both shapes.
- Reject arrays and primitives — orchestrator's `intake` is a JSON object.

### Step 3: Validator unit tests
**File:** `src/app/features/run-start/intake-json.validator.spec.ts`
**Action:** Create

Cover: valid object, valid object with whitespace, empty string (required), array (rejected), primitive (rejected), malformed JSON (parse error surfaces). Use Vitest's `expect`.

### Step 4: Wire up the component class
**File:** `src/app/features/run-start/run-start.component.ts`
**Action:** Modify

- Add imports: `inject`, `OnInit`, `computed`, `effect`; `FormBuilder`, `FormControl`, `FormGroup`, `ReactiveFormsModule`, `Validators`; `AgentsService`; `Agent`; `parseIntake`, `intakeJsonValidator`; `toSignal`; `debounceTime`.
- Add to `imports: [...]`: `ReactiveFormsModule`.
- New state:
  - `private readonly agentsService = inject(AgentsService);`
  - `private readonly fb = inject(FormBuilder);`
  - `readonly agents = signal<Agent[]>([]);`
  - `readonly agentsLoading = signal(true);`
  - `readonly agentsError = signal<string | null>(null);`
  - `readonly form = this.fb.group({ agentRef: this.fb.nonNullable.control('', { validators: [Validators.required] }), intake: this.fb.nonNullable.control('', { validators: [intakeJsonValidator] }), maxSteps: this.fb.control<number | null>(null) });`
  - `readonly intakeError = toSignal(this.form.controls.intake.statusChanges.pipe(debounceTime(200)).pipe(...))` — actually compute via a small helper: `readonly intakeErrorMessage = computed(() => { ... })` that reads `this.intakeValueDebounced()` (a debounced signal of the raw control value) and runs `parseIntake()`. The 200ms debounce is implemented by bridging the value-changes observable through `debounceTime(200)` then `toSignal`.
- `ngOnInit()` calls `loadAgents()`; `loadAgents()` sets loading=true, subscribes to `AgentsService.list()`, on success populates `agents.set(...)` and sets loading=false; on error calls `agentsError.set(err.title)` and `agentsLoading.set(false)`.
- `onFormat()` reads the current intake control value, runs `parseIntake()`, and on success calls `this.form.controls.intake.setValue(JSON.stringify(parsed, null, 2))`. On failure, no-op (the inline error is already showing).
- `onCancel()` navigates with `Location.back()` if `history.length > 1`, else `Router.navigate(['/runs'])`. Inject `Location` from `@angular/common` and `Router` for the fallback.
- `maxStepsValid()` (computed): null/blank → valid; integer ≥ 1 → valid; otherwise invalid. Wire as a custom validator on the `maxSteps` control rather than a separate computed if cleaner.
- `submitDisabled()` (computed): `submitting() || form.invalid || agents().length === 0 || !maxStepsValid()`. T-026 will read this.

### Step 5: Build out the template
**File:** `src/app/features/run-start/run-start.component.html`
**Action:** Modify

Sections, all inside the existing `max-w-3xl` card:

1. **Empty-agents state** — when `agents().length === 0 && !agentsLoading()`, render a card with `<p>No agents registered — register one in the orchestrator and refresh.</p>` and a `<button type="button" (click)="loadAgents()" data-testid="refresh-agents">Refresh agents</button>`. Replace the form section in this branch.
2. **Agents-loading state** — pulsing skeleton (match the runs-list skeleton pattern: `animate-pulse bg-slate-200 rounded h-10 w-full`).
3. **Form** (when `agents().length > 0`):
   - **Agent picker:** `<label>Agent</label><select formControlName="agentRef" data-testid="agent-picker">` with a placeholder `<option value="" disabled>Select an agent</option>` and one `<option [value]="a.ref">{{ a.ref }}</option>` per agent. Inline required-error: when `form.controls.agentRef.touched && form.controls.agentRef.invalid` show "Pick an agent." in `text-red-500 text-sm mt-1`.
   - **Intake editor:** `<label>Intake (JSON)</label><textarea formControlName="intake" rows="12" class="font-mono text-sm rounded-lg border border-slate-300 px-3 py-2 w-full focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none" data-testid="intake-editor"></textarea>`. Below: a row with the parse error (`@if (intakeErrorMessage()) {<p data-testid="intake-error" class="text-red-500 text-sm">{{ intakeErrorMessage() }}</p>}`) on the left and a `<button type="button" (click)="onFormat()" data-testid="format-button">Format</button>` on the right.
   - **`maxSteps`:** `<label>Max steps (optional)</label><input type="number" min="1" step="1" formControlName="maxSteps" data-testid="max-steps">`. Inline validation message when invalid.
   - **Footer:** Submit button (primary, sky-500, `data-testid="submit-button"`, `[disabled]="submitDisabled()"`, `type="submit"` — T-026 wires the form submit handler) and Cancel button (secondary, `data-testid="cancel-button"`, `(click)="onCancel()"`).
4. **Card error state** — if `agentsError()` is set: render `app-full-page-error` (already used by runs-list) with retry calling `loadAgents()`. This handles the case where the agents endpoint is unreachable while the route is open.

Wrap the whole form in `<form [formGroup]="form" (ngSubmit)="onSubmit($event)">` even though `onSubmit` is a no-op stub in this task; T-026 will replace the body. Define the stub:

```ts
onSubmit(event: Event): void {
  event.preventDefault();
  // T-026 will implement.
}
```

### Step 6: Extend the smoke spec into a real unit test suite
**File:** `src/app/features/run-start/run-start.component.spec.ts`
**Action:** Modify

Add tests:

- Renders the agent picker after `AgentsService.list()` resolves; options match.
- Renders the empty-state with refresh button when agents list is `[]`.
- Renders the agents-loading skeleton while in-flight (use a `Subject` to control resolution).
- `submitDisabled()` is true when intake is empty, becomes false once a valid agent is selected and valid JSON is typed.
- Inline parse error appears for malformed JSON after the 200ms debounce (use `vi.useFakeTimers()` + `tick(200)` equivalent or `fixture.whenStable()`).
- Format button rewrites the intake value to pretty-printed JSON; if intake is invalid, no-op.
- `maxSteps` validation: empty → valid; `0` → invalid; `12` → valid; non-integer rejected.
- Cancel navigates to `/runs` when history length is `1`; calls `Location.back()` otherwise. Mock `Location` and `Router`.
- `agentsError` shows the full-page error with a retry that re-calls `AgentsService.list()`.

Use a stub `AgentsService` (`provideAgentsServiceStub`) in `TestBed.configureTestingModule({ providers: [...] })`.

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `src/app/features/run-start/intake-json.validator.ts` | Create | Pure JSON parse + Angular `ValidatorFn`. |
| `src/app/features/run-start/intake-json.validator.spec.ts` | Create | Unit tests for the validator. |
| `src/app/features/run-start/run-start.component.ts` | Modify | Add form, agent loading, format/cancel handlers, computed `submitDisabled`. |
| `src/app/features/run-start/run-start.component.html` | Modify | Replace stub with empty-state / loading / form / error branches. |
| `src/app/features/run-start/run-start.component.spec.ts` | Modify | Cover loading, empty, validation, format, cancel, agentsError. |
| `src/app/core/agents.service.ts` | Modify | One-line comment documenting "every `list()` call is a fresh fetch — no cache." |

## Edge Cases & Risks

- **Debounced parse vs. typing latency:** 200ms is a reasonable feel; longer makes the error feel detached, shorter is noisy. Stick with 200ms.
- **Format button on partial input:** if the operator has typed `{ "foo":` and clicks Format, parse fails and we no-op. The inline error is already explaining why; no toast needed.
- **`maxSteps` zero/negative:** rejected by the validator, surfaces inline. Do not silently coerce blank → zero.
- **Re-entering the route after a 401:** `authGuard` redirects before the component mounts; agents won't be fetched on an expired session.
- **Agents endpoint flake:** `agentsError` keeps the form unreachable until retry. We do not auto-retry — operators may need to register an agent first; auto-retry would mask that workflow.
- **Form-level vs. control-level errors:** keep all current errors at the control level. Form-level errors (e.g., 502 on submit) belong to T-026.

## Acceptance Verification

- [ ] **AC: agent picker populated** — Spec test renders agents list after `AgentsService` resolves.
- [ ] **AC: empty agents state** — Spec asserts the refresh button appears when list is empty; clicking re-calls `AgentsService.list()`.
- [ ] **AC: malformed JSON disables submit and shows error** — Spec types `{not json`, advances debounce, asserts `submit-button` `disabled`, asserts `intake-error` text contains parser message.
- [ ] **AC: blank `maxSteps` is omitted; non-positive integers rejected** — Spec validator unit tests + component-level integration test.
- [ ] **AC: Format button pretty-prints; no-op on invalid** — Spec asserts both branches.
- [ ] **AC: Cancel navigates back / falls back to `/runs`** — Spec covers both history branches.
- [ ] **AC: validator unit tests** — `intake-json.validator.spec.ts` runs green.
