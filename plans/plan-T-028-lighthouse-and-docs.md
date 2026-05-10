# Implementation Plan: T-028 — Add `/runs/new` to Lighthouse a11y CI + update docs and changelogs

## Task Reference

- **Task ID:** T-028
- **Type:** DevOps + Documentation
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-026 (start-run screen complete and reachable in production build)
- **Rationale (from task):** Keeps the a11y gate (≥0.95) covering every shipped screen, and satisfies the CLAUDE.md documentation-maintenance discipline.

## Overview

Add `http://localhost:4200/runs/new` to `lighthouserc.json`'s URL list so the Lighthouse a11y workflow audits the new screen alongside `/login`, `/runs`, `/runs/:id`. Confirm the existing `scripts/lhci-puppeteer-login.js` already handles non-`/login` URLs (it does — it logs in once and reuses the session). Then update the four authoritative docs with FEAT-002 changelog entries dated `2026-05-10`: `docs/ui-specification.md`, `docs/api-spec.md`, `docs/ARCHITECTURE.md`, and (only if the implementation surfaced a wire-shape drift) `docs/data-model.md`.

## Implementation Steps

### Step 1: Add `/runs/new` to the Lighthouse URL list
**File:** `lighthouserc.json`
**Action:** Modify

Update the `ci.collect.url` array to:

```json
"url": [
  "http://localhost:4200/login",
  "http://localhost:4200/runs",
  "http://localhost:4200/runs/run-e2e-001",
  "http://localhost:4200/runs/new"
]
```

- Preserve the existing `desktop` preset, `onlyCategories: ["accessibility"]`, `chromeFlags`, and the `puppeteerScript` reference.
- Preserve the existing `assert.assertions` (no other categories asserted; we removed the `lighthouse:recommended` preset deliberately in commit 8d49970 to silence `auditRan` warnings).

### Step 2: Verify the puppeteer login script handles `/runs/new`
**File:** `scripts/lhci-puppeteer-login.js`
**Action:** Verify

- The current script logs in once for any URL except `/login`. `/runs/new` is non-`/login`, so it inherits the login flow without changes.
- If the script ever evolves to be route-specific (e.g., per-URL setup), `/runs/new` must remain in the "log in then audit" branch. Add a comment if the logic is non-obvious.

### Step 3: Run Lighthouse locally end-to-end
**Action:** Verify

- Boot the production stack: `npm run build && npm run lhci:serve & npm run upstream-mock & node --import tsx bff/src/server.ts &` (or the same pattern used by `.github/workflows/lighthouse.yml`).
- Run `npm run lhci:run`.
- Confirm `/runs/new` reports an a11y score ≥ 0.95. If not, file the a11y findings as follow-up tasks; do **not** lower the threshold — the CI gate is per-page, asserted as `["error", { "minScore": 0.95 }]`.
- Common issues to watch for on a form-heavy screen: missing `<label for>` associations, low-contrast secondary buttons, unannounced inline-error regions, focus order skipping the textarea.

### Step 4: Update `docs/ui-specification.md`
**File:** `docs/ui-specification.md`
**Action:** Modify

- In § "Screen: Run Start (`/runs/new`)", reflect the as-built component: states (loading agents, empty agents, default, validating, submitting, success-redirect, error scopes — page/agent/intake), validators (required agent, JSON-object intake, positive-integer `maxSteps`), error mapping (400 → intake; 404 → agent; 502/network → page).
- Add a row at the bottom of the changelog table:

  ```
  | 2026-05-10 | FEAT-002 — Run Start built; documents agent picker empty-state, JSON validator, format button, scoped error mapping. |
  ```

### Step 5: Update `docs/api-spec.md`
**File:** `docs/api-spec.md`
**Action:** Modify

- No contract change (verified during T-026 unless drift was found). Add a changelog row noting that `POST /api/v1/runs` is now consumed by the SPA and the SPA's contract assumptions are pinned to the current spec:

  ```
  | 2026-05-10 | FEAT-002 — `POST /api/v1/runs` now consumed by the SPA. Contract unchanged; SPA omits `budget` when `maxSteps` is blank. |
  ```

- If T-026 found drift (e.g., orchestrator requires `budget` always, or rejects empty-string `intake` keys), update the `POST /api/v1/runs` section in the body of the doc and reflect that in the changelog row.

### Step 6: Update `docs/ARCHITECTURE.md`
**File:** `docs/ARCHITECTURE.md`
**Action:** Modify

- In the feature-folder list (or the equivalent inventory of feature areas), add `features/run-start/`.
- Add a changelog row:

  ```
  | 2026-05-10 | FEAT-002 — Added `features/run-start/` feature area; `RunsService.startRun` extends the existing service. |
  ```

### Step 7: Decide whether `docs/data-model.md` needs an update
**File:** `docs/data-model.md`
**Action:** Conditional Modify

- The `StartRunRequest` interface introduced in T-024 is purely an SPA-side request shape; it mirrors the orchestrator's contract documented in `docs/api-spec.md`. By the rule in `CLAUDE.md` ("New entity / field on the wire" → `data-model.md`), this is **not** a new wire entity, so no update is required.
- **However:** if T-025/T-026 surfaced any new field that the SPA reads from the response that wasn't previously documented (unlikely — `RunSummary` is established), update `data-model.md` and add a changelog row.
- If no update is needed, capture that explicitly in the PR description: "No `data-model.md` change — `StartRunRequest` is an SPA-side request shape only."

### Step 8: Cross-link from the FEAT-002 work items
**Files:**
- `docs/work-items/FEAT-002-start-a-run.md`
- `docs/work-items/FEAT-002-tasks.md`

**Action:** Modify

- Flip both **Status** fields from `Proposed` to `Shipped — 2026-05-10`. (The existing FEAT-001 work-item used `Status: Proposed` at draft time; do not invent a richer state machine — match the established pattern, or skip if FEAT-001's was never updated post-merge. Worth checking before flipping.)

## Files Affected

| File | Action | Summary |
|------|--------|---------|
| `lighthouserc.json` | Modify | Add `/runs/new` to the audited URL list. |
| `scripts/lhci-puppeteer-login.js` | Verify | Confirm `/runs/new` flows through the login branch. |
| `docs/ui-specification.md` | Modify | Reflect as-built run-start states + changelog row. |
| `docs/api-spec.md` | Modify | Changelog row noting SPA consumption + drift if any. |
| `docs/ARCHITECTURE.md` | Modify | Add `features/run-start/` to the feature inventory + changelog row. |
| `docs/data-model.md` | Conditional Modify | Update only if T-025/T-026 surfaced a wire shape drift. |
| `docs/work-items/FEAT-002-*.md` | Modify | Flip status to "Shipped — 2026-05-10" if FEAT-001 followed the same pattern. |

## Edge Cases & Risks

- **A11y score below 0.95 on `/runs/new`:** the form must use `<label for>` (not visual labels only), the inline parse error must be in an `aria-live` region (`role="status"` or `role="alert"` depending on severity), the textarea must be focusable in tab order. If the score lands below threshold, fix the markup in this same PR — splitting it across PRs delays the CI gate.
- **Lighthouse pipeline reuses the static server from FEAT-001:** the new route `/runs/new` is a SPA-fallback path (no asset on disk at that name), so the bug class fixed in commit 8d49970 (asset paths under SPA routes) does not re-surface. Verify by running `curl -i http://localhost:4200/runs/new` against the production build — it should return `index.html` with `text/html` content-type.
- **Documentation drift:** if T-026 changed the response shape of `POST /api/v1/runs` based on real orchestrator behavior, both `docs/api-spec.md` and the `StartRunRequest` model must be updated. Step 5 + Step 7 are gated on what we actually shipped.
- **Status field convention:** if FEAT-001 work items still say `Status: Proposed` post-ship, we have a project-level inconsistency. Flag in the PR description rather than retroactively edit FEAT-001 in a FEAT-002 PR.

## Acceptance Verification

- [ ] **AC: Lighthouse audits `/runs/new` at ≥ 0.95** — Local lhci run + green CI on the PR.
- [ ] **AC: `docs/ui-specification.md` updated with as-built description and changelog row** — File diff.
- [ ] **AC: `docs/api-spec.md` changelog row** — File diff; drift documented if found.
- [ ] **AC: `docs/ARCHITECTURE.md` changelog row + new feature area listed** — File diff.
- [ ] **AC: `docs/data-model.md` updated if any drift, or noted in PR description as "no change"** — PR description or file diff.
