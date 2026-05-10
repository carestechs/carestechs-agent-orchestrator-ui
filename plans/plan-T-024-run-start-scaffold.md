# Implementation Plan: T-024 — Scaffold `RunStartComponent` route, model, and re-enable "Start a run" CTAs

## Task Reference

- **Task ID:** T-024
- **Type:** Frontend
- **Workflow:** mockup-first
- **Complexity:** S
- **Dependencies:** None (FEAT-001 merged)
- **Rationale (from task):** Closes the dead-end CTAs from FEAT-001 and gives downstream tasks a real component to work in. Splitting scaffold from the form fields keeps PR diffs reviewable.

## Overview

Stand up the `/runs/new` lazy route loading a new `RunStartComponent` (standalone, separate template, signals, `styles: []`). The component renders only the page shell + a card-shaped placeholder; T-025 fills in the form fields. Add a `StartRunRequest` interface to `src/app/models/`. Add the missing "Start a run" CTAs to `runs-list.component.html` (header link and empty-state CTA), per `docs/ui-specification.md` § "Screen: Runs List". Generate and approve a mockup at `mockups/t-024-run-start.html` first per the mockup-first workflow.

## Implementation Steps

### Step 1: Generate the mockup
**File:** `mockups/t-024-run-start.html`
**Action:** Create

- Use `.ai-framework/prompts/mockup-generation.md` against `docs/ui-specification.md` § "Screen: Run Start" + the modern-minimal design tokens already used by `mockups/t-013-login.html` and `mockups/t-017-run-detail.html` for visual consistency.
- Layout: page header ("Start a run", subtitle), single centered card (`max-w-3xl mx-auto`, `bg-white rounded-lg shadow-sm p-6`), form-shaped placeholders for: agent picker, intake JSON textarea (monospace, `min-h-64`), `maxSteps` numeric input, Submit + Cancel buttons in a right-aligned footer row.
- Capture the empty-state-when-no-agents copy ("No agents registered — register one in the orchestrator and refresh") and a refresh button styled as a secondary outline button.
- This mockup is consumed by T-025 (which fleshes out the form). T-024's template will only render the page-shell skeleton — header + empty card — to keep this PR small.

### Step 2: Define the `StartRunRequest` model
**File:** `src/app/models/start-run-request.ts`
**Action:** Create

```ts
export interface StartRunRequest {
  agentRef: string;
  intake: Record<string, unknown>;
  budget?: { maxSteps: number };
}
```

- Mirror the wire shape from `docs/api-spec.md` § `POST /api/v1/runs`. `intake` is unconstrained (free-form JSON object); typed as `Record<string, unknown>` to keep TS strict.
- `budget` optional; when present, `maxSteps` must be a positive integer (validation enforced by T-025's form, not the type).

### Step 3: Re-export from the models barrel
**File:** `src/app/models/index.ts`
**Action:** Modify

- Add `export * from './start-run-request';` to the existing list (alphabetical placement is fine; current file is not strictly ordered).

### Step 4: Create the component class
**File:** `src/app/features/run-start/run-start.component.ts`
**Action:** Create

```ts
import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-run-start',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './run-start.component.html',
  styles: [],
})
export class RunStartComponent {
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
}
```

- Per `CLAUDE.md`: standalone, separate template, `styles: []`, signals for state.
- T-025 will introduce `ReactiveFormsModule` and additional state (`agents`, `intakeError`, etc.); leave room for those without pre-importing.
- Named export only.

### Step 5: Create the page-shell template
**File:** `src/app/features/run-start/run-start.component.html`
**Action:** Create

- Mirror the mockup's outer shell: `max-w-3xl mx-auto py-8 px-4`, header (`Start a run`), single card placeholder containing a `<p class="text-slate-500">Form coming online — T-025.</p>` stub.
- Include a footer row with a `routerLink="/runs"` Cancel button so even the scaffold exits cleanly.
- Add `data-testid="run-start"` on the root, `data-testid="cancel-button"` on Cancel — T-027 will key its e2e selectors here.

### Step 6: Wire the lazy route
**File:** `src/app/app.routes.ts`
**Action:** Modify

- Insert the new route **before** `runs/:id` so `id="new"` cannot match the detail route:

```ts
{
  path: 'runs/new',
  canMatch: [authGuard],
  loadComponent: () =>
    import('./features/run-start/run-start.component').then((m) => m.RunStartComponent),
},
```

- The `**` catch-all and `''` redirect remain as-is.

### Step 7: Re-enable the "Start a run" CTAs on `/runs`
**File:** `src/app/features/runs-list/runs-list.component.html`
**Action:** Modify

- Header (~line 10): replace the lone `<h1>` row with a flex row containing `<h1>Runs</h1>` on the left and a primary button-styled `<a routerLink="/runs/new">` on the right (label "Start a run", `data-testid="start-run-cta-header"`). Use the same button classes the design system establishes: `inline-flex items-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 text-sm font-medium`.
- Empty state (~line 50): replace the bare `<div class="text-center py-12 text-slate-500">No runs match this filter.</div>` with a small empty-state block that includes the same copy plus a secondary button-styled `<a routerLink="/runs/new">` ("Start a run", `data-testid="start-run-cta-empty"`). Match the design language with `mt-3 inline-flex ... border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 ...`.
- No additional imports needed — `RouterLink` is already imported by the runs-list component (it's used on the run rows).

### Step 8: Add a smoke unit spec
**File:** `src/app/features/run-start/run-start.component.spec.ts`
**Action:** Create

- Render `RunStartComponent` via `TestBed`, assert it mounts (`fixture.componentInstance` exists), assert the root has `data-testid="run-start"`, assert the Cancel anchor has `routerLink="/runs"`. T-025 will extend this spec; this is just a smoke baseline.
- Provide `provideRouter([])` in the test bed.

### Step 9: Update the runs-list spec for the new CTAs
**File:** `src/app/features/runs-list/runs-list.component.spec.ts`
**Action:** Modify

- Add an assertion that the rendered template includes an anchor with `data-testid="start-run-cta-header"` and `routerLink="/runs/new"`.
- Add a test for the empty-state branch (mock the runs list to return `[]`) asserting `data-testid="start-run-cta-empty"` is present.
- Do not assert Tailwind classes (per `CLAUDE.md` testing convention).

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `mockups/t-024-run-start.html` | Create | Approved mockup for the run-start screen (form layout + states). |
| `src/app/models/start-run-request.ts` | Create | `StartRunRequest` interface mirroring `POST /api/v1/runs`. |
| `src/app/models/index.ts` | Modify | Re-export `start-run-request`. |
| `src/app/features/run-start/run-start.component.ts` | Create | Standalone component shell with `submitting` / `error` signals. |
| `src/app/features/run-start/run-start.component.html` | Create | Page-shell skeleton with stub card and Cancel anchor. |
| `src/app/features/run-start/run-start.component.spec.ts` | Create | Smoke render test. |
| `src/app/app.routes.ts` | Modify | Add `runs/new` route before `runs/:id`. |
| `src/app/features/runs-list/runs-list.component.html` | Modify | Add header CTA and empty-state CTA pointing at `/runs/new`. |
| `src/app/features/runs-list/runs-list.component.spec.ts` | Modify | Cover both CTAs in tests. |

## Edge Cases & Risks

- **Route ordering:** `/runs/new` must precede `/runs/:id`. If reversed, navigating to `/runs/new` would render `RunDetailComponent` with `id="new"` and the BFF would 404. Verified by Step 6 ordering and an optional unit assertion against `appRoutes` index order.
- **Deep-link entry without history:** Cancel uses `routerLink="/runs"` rather than `Location.back()` here; T-025 will revisit this when the form has dirty state to consider. For the scaffold, a deterministic destination is simpler and safer.
- **`AuthGuard` cookie expiry:** Same redirect-to-`/login` flow as the rest of `/runs/*` — no special handling needed.
- **Mockup drift:** The mockup is deliberately tight on scope (page shell + form placeholders). When T-025 lands, the as-built screen may add small affordances (refresh button copy, parse-error placement). Accept that drift; do not retroactively edit the mockup.

## Acceptance Verification

- [ ] **AC: navigation** — Manually navigate to `/runs/new` while authenticated; component mounts. Repeat unauthenticated; redirected to `/login` (covered by existing `authGuard` behavior, no new test needed).
- [ ] **AC: header CTA** — `runs-list.component.spec.ts` asserts `data-testid="start-run-cta-header"` and its `routerLink`.
- [ ] **AC: empty CTA** — `runs-list.component.spec.ts` asserts `data-testid="start-run-cta-empty"` in the empty-state branch.
- [ ] **AC: standalone + signals + styles** — Manual code review of `run-start.component.ts`: `standalone: true`, `templateUrl`, `styles: []`, `signal()` declarations.
- [ ] **AC: model present** — `tsc -p tsconfig.app.json` passes; `import { StartRunRequest } from 'src/app/models'` resolves (smoke import inside the spec is sufficient).
- [ ] **AC: mockup approved** — `mockups/t-024-run-start.html` exists and matches the page-shell + form layout described in `docs/ui-specification.md` § "Screen: Run Start".
