# Implementation Plan: T-013 — Mockup — Login screen

## Task Reference
- **Task ID:** T-013
- **Type:** Frontend
- **Workflow:** mockup-first
- **Complexity:** S
- **Rationale:** Workflow `mockup-first` requires an approved mockup before the screen is implemented (T-014).

## Overview
Produce a single self-contained HTML mockup at `mockups/t-013-login.html` that shows all states of the `/login` screen side-by-side using the modern-minimal design tokens. The mockup is a static visual prototype only (no JS logic) and is reviewed by the operator stakeholder before the Angular implementation begins in T-014.

## Implementation Steps

### Step 1: Gather screen context from the UI specification
**File:** `docs/ui-specification.md` (read-only)
**Action:** Read
Read the "Screen: Login" block (purpose, layout, components, states) and the "Design System (Modern Minimal)" section. Confirm the Login layout: centered card, `max-w-md`, vertically centered viewport; passphrase input; primary "Sign in" button; inline error slot.

### Step 2: Confirm design tokens and conventions
**File:** `CLAUDE.md` (read-only)
**Action:** Read
Confirm the Design System tokens: primary `sky-500` (#0EA5E9), neutrals `slate-*`, error `red-500`, fonts Poppins (headings) + Inter (body), card padding `p-6`, buttons `rounded-lg`, focus ring `focus-visible:ring-2 ring-sky-500 ring-offset-2`. These will be wired into the mockup's Tailwind config.

### Step 3: Identify states to render
**File:** N/A (planning step)
**Action:** Plan
States derived from the UI spec plus the auth-guard behavior in `docs/ui-specification.md` § "Behavior: Auth Guard":
1. **Default** — empty passphrase, button enabled.
2. **Loading** — passphrase masked, button disabled with spinner + "Signing in…".
3. **Invalid passphrase** — inline error keyed off `code: invalid-passphrase` ("Incorrect passphrase.").
4. **Session expired notice** — banner above the form when `?reason=expired` is present.

### Step 4: Build the HTML scaffold
**File:** `mockups/t-013-login.html`
**Action:** Create
Create a single HTML file following `.ai-framework/prompts/mockup-generation.md` output format. Include:
- DOCTYPE, viewport meta, `<title>`.
- Tailwind Play CDN `<script>`.
- Google Fonts `<link>` for **Poppins** (headings) and **Inter** (body) — note the project uses Poppins+Inter, not the Inter+Roboto from the prompt example.
- Material Icons `<link>`.
- `<script>tailwind.config = { theme: { extend: { fontFamily: { display: ['Poppins'], sans: ['Inter'] }, colors: { primary: '#0EA5E9' } } } }</script>` — rely on Tailwind's named `sky/violet/slate/emerald/amber/red` palettes for the rest.

### Step 5: Add reviewer header and grid container
**File:** `mockups/t-013-login.html`
**Action:** Modify
Add the reviewer header `T-013 Login Mockup — states shown side-by-side` and a responsive grid (`grid grid-cols-1 lg:grid-cols-2 gap-12`) inside `main`. Each state lives in its own `<section>` with an uppercase `tracking-wider` label.

### Step 6: Render each state with realistic content
**File:** `mockups/t-013-login.html`
**Action:** Modify
Render the 4 states inside the grid:
- Use a centered `max-w-md` card (`bg-white rounded-lg shadow-sm p-6`) per state.
- Logo / product title in Poppins.
- Passphrase input `type="password"` styled with `rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-500 focus:ring-2 focus:ring-sky-100`.
- Primary button `bg-sky-500 hover:bg-sky-600 text-white rounded-lg px-4 py-2`.
- Loading variant adds an inline spinner div using `border-2 border-white/40 border-t-white animate-spin rounded-full h-4 w-4`.
- Error variant adds `text-red-600 text-sm` below input with the `invalid-passphrase` copy.
- Expired variant adds a `bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm` banner above the card.

### Step 7: Self-review against the post-generation checklist
**File:** `mockups/t-013-login.html`
**Action:** Verify
Walk through the checklist in `.ai-framework/prompts/mockup-generation.md`: opens by double-click, all 4 states labeled, tokens match, no JS logic beyond Tailwind config, naming convention `mockups/t-013-login.html` correct.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `mockups/t-013-login.html` | Create | Single self-contained HTML mockup of the Login screen with 4 states. |

## Edge Cases & Risks
- **Banner + error simultaneously.** A user may land with `?reason=expired` and then submit a wrong passphrase. The mockup's "Invalid passphrase" state shows only the inline error to keep states visually distinct; production should support both at once but that combined state does not need a dedicated mockup tile.
- **Passphrase visibility toggle.** Out of scope for v1 — mockup uses `type="password"` only.
- **Mockup convention.** No prior mockups exist; this file establishes the `mockups/{task-id-lowercase}-{screen-name}.html` convention used by T-015 and T-017.
- **Font drift.** The mockup-generation template example uses Inter + Roboto; this project uses Poppins + Inter — do not copy the example fonts blindly.

## Acceptance Verification
- [ ] **AC-1 — Mockup file committed under `mockups/login.html` (or repo convention) using only Tailwind classes from the modern-minimal profile.** Verify `mockups/t-013-login.html` exists, uses only Tailwind utility classes (no inline styles except Material Icons `font-size`), and the Tailwind config maps modern-minimal tokens.
- [ ] **AC-2 — Includes empty, loading, and error states.** Verify all 4 sections render: Default (empty), Loading, Invalid passphrase (error), Session expired (banner).
- [ ] **AC-3 — Reviewed and approved by the operator stakeholder before T-014 starts.** Tracked outside the file: stakeholder sign-off recorded on the FEAT-001 work item.
