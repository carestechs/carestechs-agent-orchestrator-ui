# UI Specification

## Overview

This document specifies screens, components, and interactions for the operator console. The visual language is the `modern-minimal` profile from `carestechs-ui-design`. Tokens, spacing, and component behaviors below are direct lifts of that profile — when in doubt, the profile and its DDRs win.

---

## Design System (Modern Minimal)

### Colors

| Token | Hex | Tailwind | Usage |
|-------|-----|---------|-------|
| `primary` | #0EA5E9 | `sky-500` | Primary actions, active states, links |
| `primary-light` | #E0F2FE | `sky-100` | Hover backgrounds, selected rows |
| `primary-dark` | #0284C7 | `sky-600` | Pressed states |
| `secondary` | #8B5CF6 | `violet-500` | Secondary accents |
| `neutral-50` | #F8FAFC | `slate-50` | Page background |
| `neutral-100` | #F1F5F9 | `slate-100` | Subtle surface |
| `neutral-200` | #E2E8F0 | `slate-200` | Borders, dividers |
| `neutral-500` | #64748B | `slate-500` | Secondary text |
| `neutral-700` | #334155 | `slate-700` | Body text |
| `neutral-900` | #0F172A | `slate-900` | Headings |
| `success` | #10B981 | `emerald-500` | `completed` |
| `warning` | #F59E0B | `amber-500` | `paused` |
| `error` | #EF4444 | `red-500` | `failed`, error states |
| `info` | #0EA5E9 | `sky-500` | `running` |

### Typography

- **Heading font:** Poppins. **Body font:** Inter. Both loaded via `<link>` from Google Fonts in `index.html`.
- h1 36/700/1.2; h2 28/600/1.3; h3 20/600/1.4; body 16/400/1.6; body-sm 14/400/1.5; caption 12/400/1.4.

### Spacing & Layout

- Card padding `p-6`. Section gap `gap-8`. Page padding `py-8`.
- Reading-focused pages `max-w-5xl mx-auto`. Dashboards (runs list, run detail) `max-w-7xl mx-auto`.
- Sidebar navigation on desktop ≥`lg`. Mobile-first; hamburger drawer on `<lg`.

### Components

- **Buttons:** `rounded-lg`, `px-4 py-2`, focus ring `focus-visible:ring-2 ring-sky-500 ring-offset-2`. Variants: primary (sky bg, white text), secondary (slate-100 bg, slate-700 text), danger (red bg, white text), ghost (transparent, sky-700 text).
- **Cards:** Elevated — `bg-white rounded-lg shadow-sm p-6`. Clickable cards: `hover:shadow-md hover:-translate-y-0.5 transition-all duration-200`. No border on elevated cards.
- **Tables:** Zebra-striping off; `divide-y divide-slate-200`. Header `text-slate-500 text-xs uppercase tracking-wide`. Row hover `hover:bg-slate-50`.
- **Badges (status):** pill `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium`. Color by status (see Status Badge below).
- **Forms:** Labels `text-sm font-medium text-slate-700`. Inputs `rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-500 focus:ring-2 focus:ring-sky-100`. Error text `text-red-600 text-sm`.
- **Modals:** Centered, `max-w-lg`, `rounded-lg`, `shadow-lg`, backdrop `bg-slate-900/50`.
- **Empty state:** Centered icon (slate-300), `h3` slate-700, body slate-500, single primary CTA.
- **Skeleton:** `animate-pulse bg-slate-200 rounded`. Match height of replaced content.
- **Spinner:** `border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin h-5 w-5`.
- **Focus ring:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2`.

### Interactions

- Card hover lift: `hover:shadow-md hover:-translate-y-0.5 transition-all duration-200`.
- Button press: `active:translate-y-px`.
- All transitions `duration-200 ease-out`.

### Accessibility

- Color contrast meets WCAG AA. Status badges include text label, not color alone.
- All interactive elements have visible focus rings.
- ARIA-live region (`aria-live="polite"`) wraps the trace stream so screen readers can hear new lines.

---

## Status Badge Mapping

Single component `app-status-badge` rendering the run status.

| Status | Bg | Text | Label |
|--------|----|------|-------|
| `running` | `bg-sky-100` | `text-sky-700` | Running |
| `paused` | `bg-amber-100` | `text-amber-700` | Paused |
| `completed` | `bg-emerald-100` | `text-emerald-700` | Completed |
| `failed` | `bg-red-100` | `text-red-700` | Failed |
| `cancelled` | `bg-slate-200` | `text-slate-600` | Cancelled |

Same component reused for trace executor-call states (`dispatched`, `completed`, `failed`).

---

## Routes

| Path | Component | Auth | Notes |
|------|-----------|------|-------|
| `/login` | `LoginComponent` | public | Redirects authenticated users to `/runs`. |
| `/` | redirect | — | → `/runs` |
| `/runs` | `RunsListComponent` | required | Default page. Filterable list. |
| `/runs/new` | `RunStartComponent` | required | Start-run form. |
| `/runs/:id` | `RunDetailComponent` | required | Live trace, signal form, cancel. |
| `**` | `NotFoundComponent` | required | |

All non-public routes lazy-load via `loadComponent`.

---

## Screen: Login

**Purpose:** Operator submits the shared passphrase to obtain a session cookie.

**Layout:** Centered card, `max-w-md`, vertically centered viewport.

**Components:** App logo / title, passphrase input (`type="password"`), Sign in button (primary), inline error on `401`.

**States:**
- Default
- Submitting (button shows spinner, disabled)
- Error (`code: invalid-passphrase` → "Incorrect passphrase.")

---

## Screen: Runs List (`/runs`)

**Purpose:** Show runs needing attention. Default filter: `status=paused`.

**Layout:**
```
┌──────────── Sidebar ────────────┬───────────────── Main ─────────────────┐
│ • Runs (active)                 │  Runs                                  │
│ • Start a run                   │  [status ▼ paused] [agentRef ▼ all] (Start a run →)
│                                 │  ┌──────────────────────────────────┐  │
│                                 │  │ Card: id, agentRef, intake,      │  │
│                                 │  │ startedAt, status badge          │  │
│                                 │  └──────────────────────────────────┘  │
│                                 │  ...                                   │
│                                 │  [« 1 2 3 »]                           │
└─────────────────────────────────┴────────────────────────────────────────┘
```

**Components:**
- `app-status-filter` — segmented control: All / Running / Paused / Completed / Failed / Cancelled. Default Paused.
- `app-agent-filter` — dropdown populated from `GET /api/v1/agents`.
- `app-run-card` — clickable card per run. Shows: status badge, intake summary (truncated `featureBriefPath`), agentRef as caption, startedAt relative time, `currentNode` if present.
- `app-pagination` — offset pagination control.

**States:**
- Loading: 5 skeleton cards.
- Empty: empty-state with "No runs match this filter." and a "Start a run" CTA.
- Error: full-card error state with retry.
- Loaded: cards in a single column on mobile, two columns on `lg`.

**Interactions:**
- Click card → `/runs/:id`.
- Filter change → re-fetch with new query params and reset to page 1.
- Auto-refresh: re-fetch every 15s when no run is open in another tab. Not a websocket; just polling for the list.

---

## Screen: Run Detail (`/runs/:id`)

**Purpose:** Watch a run progress in real time, send the awaited signal, or cancel it.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ← Runs    Run abc12345    [status badge]    [Cancel run]        │
│ agentRef · intake.featureBriefPath · startedAt · currentNode    │
├─────────────────────────────────┬───────────────────────────────┤
│ Trace timeline (live, 2/3 width)│ Awaiting signal (1/3 width)   │
│ ▼ step 17  request_implementation                               │
│   • executor_call human dispatched │ Task: T-001               │
│ ▶ step 16  approve_plan          │ Commit SHA: [_______]        │
│ ▶ step 15  generate_plan         │ PR URL:     [_______]        │
│ ...                              │ Diff:       [textarea]       │
│                                  │ Notes:      [textarea]       │
│                                  │ [Submit signal] [Cancel run] │
└─────────────────────────────────┴───────────────────────────────┘
```

On `<lg`: stacked single-column; signal panel collapses above the trace.

**Components:**
- `app-run-header` — title, status badge, intake summary, cancel button.
- `app-trace-timeline` — vertical list of step groups; each group expandable to show its `executor_call`s. Live-tails the NDJSON stream.
- `app-trace-record` — one record. Discriminated rendering on `kind`. `executor_call` records show node, mode badge, state badge, and a JSON viewer for `intake`/`result`.
- `app-signal-form` — visible only when the run is `paused` and there is an awaiting human dispatch. Pre-fills `taskId` from that dispatch's `intake`.
- `app-cancel-button` — confirms via modal; only enabled on non-terminal runs.

**States:**
- Initial load: skeleton header + skeleton timeline.
- Streaming: live updates appended to the timeline. ARIA-live announces new step groups.
- Paused with awaiting human: signal panel slides in from the right (desktop) or pinned to top (mobile).
- Terminal: signal panel hidden; status banner ("Completed at ...", "Failed: correction_budget_exceeded", etc.). Trace ends after stream closes.
- Stream error: inline banner above timeline ("Lost connection. [Reconnect]"); the timeline stays mounted.

**Signal form fields:**

| Field | Required | Validation |
|-------|----------|------------|
| Task ID | yes (prefilled, editable) | non-empty, must match an awaiting task on submit |
| Commit SHA | yes | 7–40 hex chars |
| PR URL | yes | valid `https://` URL |
| Diff | no | text |
| Implementation Notes | no | text |

Submit posts to `/api/v1/runs/:id/signals`. On `202`, show success toast and clear `commitSha`/`prUrl`/`diff`/`notes`. On `409`, refresh the run. On `404` (`task-not-in-run-memory`), highlight Task ID with the inline error and re-pick from the awaiting dispatch.

---

## Screen: Run Start (`/runs/new`)

**Purpose:** Kick off a new run.

**Components:**
- Agent dropdown (from `GET /api/v1/agents`).
- Intake JSON editor (textarea with monospace; client-side JSON validation).
- Optional `maxSteps` numeric input.
- Submit (`Start run`) and Cancel.

**States:** default, validating, submitting, success → redirect to `/runs/:id`, error → inline.

---

## Cross-cutting Components

- **`app-toast`** — global toast service for transient errors and successes. `success` (emerald), `error` (red), `info` (sky). Auto-dismiss 4s; persistent on errors with retry actions.
- **`app-modal`** — generic confirmation modal used by cancel-run.
- **`app-empty-state`** — icon + heading + body + optional CTA. Used on empty list and 404 detail.
- **`app-error-state`** — full-card / full-page error with title (from `ProblemDetails.title`), code, and retry.
- **`app-skeleton`** — pulsing rectangle.
- **`app-spinner`** — small inline spinner for buttons.

## Behavior: Trace Stream

- Implemented in `core/trace-stream.service.ts` using `fetch` and the response body's `ReadableStream`.
- Each line is parsed; malformed lines are dropped with a `console.warn` (do not surface to user).
- The service exposes a `signal<TraceRecord[]>` and a `signal<'connecting' | 'streaming' | 'closed' | 'error'>` for connection state.
- Reconnection: on transient close, retry once after 1s. On second failure, surface an inline banner with manual reconnect.
- The detail page passes `?follow=true&since=<latestRecordOccurredAt>` on reconnect to avoid duplicates.

## Behavior: Auth Guard

- `core/auth.guard.ts` calls `GET /auth/me` once on app bootstrap. If unauthenticated, redirect to `/login` preserving `returnUrl`.
- Any `401` from `/api/v1/*` triggers session expiry: clear local state, redirect to `/login?reason=expired`.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial UI spec — modern-minimal tokens, three feature screens (login, runs list, run detail), start-run, plus cross-cutting components. |
