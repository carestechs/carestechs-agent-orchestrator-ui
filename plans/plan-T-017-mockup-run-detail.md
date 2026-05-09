# Implementation Plan: T-017 — Mockup — Run detail screen

## Task Reference
- **Task ID:** T-017
- **Type:** Frontend
- **Workflow:** mockup-first
- **Complexity:** L
- **Rationale:** Most complex screen in the v1 critical path — mockup approval avoids implementation rework on the load-bearing flow (T-018, T-019).

## Overview
Produce a single self-contained HTML mockup at `mockups/t-017-run-detail.html` that shows all states of `/runs/:id` side-by-side: header (id, agentRef, intake, status badge, Cancel), live trace timeline visually distinguishing the 5 record kinds (`step | policy_call | webhook_event | executor_call | effector_call`), awaiting-signal panel pre-filled from the latest `executor_call (state=dispatched, mode=human)`, signal form fields (`commitSha`, `prUrl`, `diff`, `implementationNotes`), and the cancel-confirmation modal. Reading-focused width `max-w-5xl` for the trace column.

## Implementation Steps

### Step 1: Gather screen context from the UI specification
**File:** `docs/ui-specification.md` (read-only)
**Action:** Read
Read the "Screen: Run Detail" section (header, trace timeline, signal panel layout, signal form fields table) and the "Behavior: Trace Stream" section. Note: the trace column uses `max-w-5xl` reading width per the task brief and the UI spec's reading-focused convention.

### Step 2: Pull realistic placeholder content from API spec and data model
**File:** `docs/api-spec.md`, `docs/data-model.md` (read-only)
**Action:** Read
Extract realistic content for:
- `RunDetail` fields: `id` UUID, `agentRef: 'lifecycle-agent@0.3.0'`, `status`, `intake.featureBriefPath: 'docs/work-items/FEAT-042.md'`, `startedAt`, `lastStepNumber`, `currentNode`, `terminationReason`, `budget.maxSteps`.
- `TraceRecord` variants for the 5 kinds: `StepRecord` (nodeName, state), `ExecutorCallRecord` (nodeName, mode, state, intake, result), `PolicyCallRecord` (provider, model, toolSelected, tokens, latency), `WebhookEventRecord` (source, payload), `EffectorCallRecord` (effector, result).
- `SignalRequest`/`SignalPayload` fields: `taskId: 'T-001'`, `commitSha`, `prUrl`, `diff`, `implementationNotes`.

### Step 3: Confirm design tokens and conventions
**File:** `CLAUDE.md` (read-only)
**Action:** Read
Confirm: status colors per `RunStatus`, modal pattern (centered, `max-w-lg`, `rounded-lg`, `shadow-lg`, backdrop `bg-slate-900/50`), button variants, focus-trapped look on the modal, `max-w-5xl` reading width.

### Step 4: Identify states to render
**File:** N/A (planning step)
**Action:** Plan
States required by the task brief:
1. **Paused with awaiting human dispatch** — header with Cancel button, trace timeline ending in an `executor_call dispatched/human`, signal form pre-filled.
2. **Running** — no signal form, trace continues, status badge sky.
3. **Terminal — completed** — no Cancel button, no signal form, terminationReason chip / endedAt shown.
4. **Cancel-confirmation modal overlay** — full screen tile with the modal centered over a darkened backdrop.

### Step 5: Build the HTML scaffold
**File:** `mockups/t-017-run-detail.html`
**Action:** Create
Same scaffold as T-013/T-015 (Tailwind Play CDN, Google Fonts Poppins+Inter, Material Icons, Tailwind config). Reviewer header `T-017 Run Detail Mockup — states shown side-by-side`. Top-level grid `grid grid-cols-1 xl:grid-cols-2 gap-12` so two state tiles share the viewport on wide monitors.

### Step 6: Build a shared timeline + record-kind component pattern
**File:** `mockups/t-017-run-detail.html`
**Action:** Modify
Define a vertical timeline pattern reused across states: each record is a row with a leading colored dot/icon keyed to `kind`:
- `step` — slate dot, `align_horizontal_left` icon.
- `executor_call` — sky/amber dot (color depends on `state`), `play_circle` icon, mode badge (`human`/`local`/`remote`/`engine`).
- `policy_call` — violet dot, `psychology` icon, model + tokens + latency caption.
- `webhook_event` — emerald dot, `webhook` icon, source caption.
- `effector_call` — slate dot, `bolt` icon, effector caption.
Each row has timestamp on the right (`text-xs text-slate-400`), step number badge on the left.

### Step 7: Render the Paused-awaiting-human state
**File:** `mockups/t-017-run-detail.html`
**Action:** Modify
Two-column layout in this tile:
- Left column (`max-w-5xl` reading-focused but flex-1 inside the tile): header card with breadcrumb "← Runs", H1 "Run abc12345" (Poppins, slate-900), Paused amber badge, agentRef + intake.featureBriefPath + startedAt + currentNode caption, Cancel button (`bg-red-500 text-white rounded-lg` ghost-danger style or `bg-white border border-red-200 text-red-600 hover:bg-red-50`). Below: trace timeline with ~6 records illustrating all 5 kinds, ending with an `executor_call` `state=dispatched mode=human nodeName=request_implementation` highlighted with an amber ring `ring-2 ring-amber-300`.
- Right column (`w-96` aside): "Awaiting signal" card `bg-white rounded-lg shadow-sm p-6 sticky top-0`. Read-only `taskId='T-001'` chip, then form fields: `commitSha` text input (placeholder `abc1234`), `prUrl` URL input (placeholder `https://github.com/org/repo/pull/42`), `diff` textarea (3 rows), `implementationNotes` textarea (3 rows). Primary "Submit signal" button + secondary "Reset". All inputs use the modern-minimal form pattern.

### Step 8: Render the Running state
**File:** `mockups/t-017-run-detail.html`
**Action:** Modify
Single-column tile (`max-w-5xl mx-auto`): header card with sky "Running" badge, no Cancel disabled state — Cancel button is shown and enabled. Trace timeline shows ~5 records mid-flight, ending with a `step` `state=started` (currentNode = `generate_plan`). No awaiting-signal panel anywhere.

### Step 9: Render the Terminal — completed state
**File:** `mockups/t-017-run-detail.html`
**Action:** Modify
Single-column tile: header card with emerald "Completed" badge, no Cancel button, terminationReason chip "done_node" rendered as a `bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5` pill, `endedAt` caption "Completed at 2026-05-09T11:42:18Z". Trace timeline shows the final 4–5 records ending in `step state=completed nodeName=done`. No signal form.

### Step 10: Render the Cancel-confirmation modal state
**File:** `mockups/t-017-run-detail.html`
**Action:** Modify
Full-tile overlay: a faded version of the Paused state in the background (use `opacity-50 pointer-events-none`), then a `bg-slate-900/50` backdrop overlay, and the centered modal `bg-white rounded-lg shadow-lg max-w-lg p-6` with H3 "Cancel this run?" (Poppins), body "The run will be marked `cancelled` and the orchestrator will stop dispatching tasks. This cannot be undone.", and footer with secondary "Keep running" + danger primary `bg-red-500 hover:bg-red-600 text-white rounded-lg` "Yes, cancel run". Use a focus-ring on the danger button to convey focus-trap.

### Step 11: Self-review against the post-generation checklist
**File:** `mockups/t-017-run-detail.html`
**Action:** Verify
- All 5 trace record kinds visually distinguishable.
- All 4 states labeled and rendered.
- Reading-focused trace column at `max-w-5xl`.
- No JS logic, no inline styles (except Material Icons `font-size`).
- File opens by double-click.
- Naming `mockups/t-017-run-detail.html` matches convention.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `mockups/t-017-run-detail.html` | Create | Single self-contained HTML mockup of the Run Detail screen with 4 states (paused-awaiting, running, completed, cancel modal). |

## Edge Cases & Risks
- **Awaiting-dispatch absence.** When `status=paused` but no `executor_call mode=human state=dispatched` exists, the panel must hide. The Running state doubles as the "no awaiting dispatch" example.
- **Terminal-state visibility.** Cancel button must disappear on terminal runs; the Completed tile demonstrates this. Failed and Cancelled terminal variants share visual treatment — only Completed is rendered to keep the mockup focused.
- **Multiple concurrent dispatches.** Per FEAT-001 risks, the brief assumes a single awaiting `executor_call`; mockup shows a single dispatch. A picker UI may be added later but is out of scope for this mockup.
- **Stream error banner.** UI spec mentions an inline "Lost connection. [Reconnect]" banner over the timeline. Out of scope for this mockup tile-set; may be added in a follow-up if stakeholder requests.
- **Long intake / diff content.** The mockup uses short realistic placeholder values; production should clamp with `truncate` and provide expand-on-click — implementation detail.

## Acceptance Verification
- [ ] **AC-1 — Mockup at `mockups/run-detail.html` shows: paused-with-awaiting-dispatch state, running-no-form state, terminal state, cancel-confirmation state.** Verify all 4 states are rendered as labeled `<section>`s in the file.
- [ ] **AC-2 — Trace timeline visually distinguishes the 5 record kinds.** Verify each `kind` (`step | policy_call | webhook_event | executor_call | effector_call`) renders with a unique icon + color combination across the rendered timelines.
- [ ] **AC-3 — Reading-focused width `max-w-5xl` for the trace column.** Verify the Running and Completed single-column tiles use `max-w-5xl mx-auto`, and the Paused tile's primary trace column wraps at this width.
- [ ] **AC-4 — Approved by stakeholder before T-018.** Tracked outside the file via FEAT-001 sign-off.
