# Implementation Plan: T-015 — Mockup — Runs list screen

## Task Reference
- **Task ID:** T-015
- **Type:** Frontend
- **Workflow:** mockup-first
- **Complexity:** M
- **Rationale:** This is the highest-traffic screen and demands stakeholder review before implementation; workflow `mockup-first` requires an approved mockup before T-016.

## Overview
Produce a single self-contained HTML mockup at `mockups/t-015-runs-list.html` that shows all states of the `/runs` screen side-by-side using the modern-minimal design tokens (sidebar nav, dashboard width `max-w-7xl`, status filter defaulting to Paused, agentRef dropdown, table of runs, pagination). The mockup is the visual contract reviewed before T-016 begins.

## Implementation Steps

### Step 1: Gather screen context from the UI specification
**File:** `docs/ui-specification.md` (read-only)
**Action:** Read
Read the "Screen: Runs List" section: layout (sidebar + main, status filter, agentRef dropdown, run cards/rows, pagination), components (`app-status-filter`, `app-agent-filter`, `app-run-card`, `app-pagination`), and states (Loading, Empty, Error, Loaded). Confirm `max-w-7xl mx-auto` dashboard width and the modern-minimal table conventions.

### Step 2: Pull realistic placeholder content from API spec
**File:** `docs/api-spec.md` (read-only)
**Action:** Read
Extract realistic field values from the `GET /api/v1/runs` and `GET /api/v1/agents` response examples: `id` UUIDs, `agentRef: 'lifecycle-agent@0.3.0'`, `status: 'paused'|'running'|...`, `intake.featureBriefPath: 'docs/work-items/FEAT-042.md'`, `startedAt: '2026-05-09T09:01:00Z'`, `lastStepNumber: 17`. Also note the `502 upstream-error` and `500 upstream-unavailable` codes for the error state.

### Step 3: Confirm design tokens and conventions
**File:** `CLAUDE.md` (read-only)
**Action:** Read
Confirm: primary `sky-500`, accent `violet-500`, page bg `slate-50`, body `slate-700`, headings `slate-900`, status colors (paused=amber, running=sky, completed=emerald, failed=red, cancelled=slate), Poppins/Inter, `rounded-lg`, card `p-6`, `shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200` on clickable rows.

### Step 4: Identify states to render
**File:** N/A (planning step)
**Action:** Plan
States from the task brief plus the AC list:
1. **Default — paused runs loaded** (sidebar, filters, table of paused runs, pagination).
2. **Empty** ("No paused runs").
3. **Loading skeleton** (table rows shimmer).
4. **Full-page error** (`502 upstream-unavailable`/`upstream-error`) with Retry button.

### Step 5: Build the HTML scaffold
**File:** `mockups/t-015-runs-list.html`
**Action:** Create
Same scaffold as T-013 (Tailwind Play CDN, Google Fonts Poppins+Inter, Material Icons, Tailwind config for `primary: '#0EA5E9'` and font families). Reviewer header `T-015 Runs List Mockup — states shown side-by-side`. Top-level grid `grid grid-cols-1 xl:grid-cols-2 gap-12` so the two large dashboard tiles fit side-by-side on wide monitors.

### Step 6: Render the Default state
**File:** `mockups/t-015-runs-list.html`
**Action:** Modify
Inside the first `<section>`, render a full app shell:
- Left `<aside>` `w-56 bg-white border-r border-slate-200`: brand mark + nav items (Runs active = `bg-sky-50 text-sky-700`, "Start a run" muted).
- Right `<main class="max-w-7xl mx-auto py-8 px-8 flex-1">`: H1 "Runs" (Poppins), filter bar with status segmented control (Paused selected = `bg-sky-500 text-white`), agentRef dropdown styled like an input, primary "Start a run →" CTA on the right.
- Card `bg-white rounded-lg shadow-sm` containing a `<table>` with header `text-slate-500 text-xs uppercase tracking-wide`, `divide-y divide-slate-200`, columns: status badge / agentRef / intake / startedAt / lastStepNumber. 5–6 rows of realistic data (mix of FEAT-042, FEAT-051 intake paths, varied step numbers, all status=paused given the active filter).
- Pagination control `« 1 2 3 »` below the card, with Prev disabled.

### Step 7: Render the Empty, Loading, and Error states
**File:** `mockups/t-015-runs-list.html`
**Action:** Modify
- **Empty:** same shell, but the card body contains a centered empty-state: slate-300 `inbox` Material icon, slate-700 H3 "No paused runs", slate-500 body "Nothing is waiting on a human signal right now.", primary "Start a run" button.
- **Loading:** same shell; card body shows 5 skeleton rows using `animate-pulse bg-slate-200 rounded h-4` blocks at varied widths.
- **Error:** full-page error state — centered, `red-50` icon background with `error_outline` icon, H2 "Couldn't reach the orchestrator", body "BFF returned 502 upstream-unavailable. Try again in a moment.", primary `Retry` button. No table visible.

### Step 8: Self-review against the post-generation checklist
**File:** `mockups/t-015-runs-list.html`
**Action:** Verify
Open in a browser (mentally): all 4 states labeled, no inline styles, no JS, naming `mockups/t-015-runs-list.html`, tokens map to modern-minimal.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `mockups/t-015-runs-list.html` | Create | Single self-contained HTML mockup of the Runs List screen with 4 states. |

## Edge Cases & Risks
- **Status filter visibility.** The default filter is `paused`; rows shown are all paused. The mockup includes the segmented control showing the other statuses for context, even though they're not "selected".
- **agentRef dropdown cardinality.** Per the FEAT-001 risk register, dozens of agents would require typeahead — out of scope; mockup shows a simple `<select>`-styled control listing 1–3 agent refs.
- **Auto-refresh polling indicator.** UI spec mentions 15s polling; mockup is static so no spinner is shown — implementation detail for T-016.
- **Card vs. table rendering.** The UI spec mentions both "card per run" and "table" rendering; the task brief explicitly requests table columns, so the mockup uses a table inside an elevated card. Adjust in T-016 if stakeholder prefers cards.

## Acceptance Verification
- [ ] **AC-1 — Mockup uses modern-minimal tokens (sky primary, elevated cards, `rounded-lg` buttons, `max-w-7xl` dashboard width).** Verify the Tailwind config maps `primary: '#0EA5E9'` and the rendered shell uses `max-w-7xl`, `bg-white rounded-lg shadow-sm`, `rounded-lg` buttons.
- [ ] **AC-2 — Renders empty state ("No paused runs") and loading skeletons.** Verify the Empty state section and the Loading skeleton rows are present and labeled.
- [ ] **AC-3 — Approved by stakeholder before T-016.** Tracked outside the file via FEAT-001 sign-off.
