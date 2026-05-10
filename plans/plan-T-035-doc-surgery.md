# Implementation Plan: T-035 — Doc surgery: ARCHITECTURE, api-spec, ui-spec, CLAUDE.md, stakeholder definition

## Task Reference
- **Task ID:** T-035
- **Type:** Documentation
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-029 through T-034 — docs describe what shipped, not what was planned.
- **Rationale:** Doc accuracy is part of the migration's definition of done.

## Overview
Walk every authoritative doc and rewrite the BFF mentions. CLAUDE.md gets the heaviest revision because every future task generation reads it. ARCHITECTURE.md gains an explicit "Interim security posture" subsection naming the network-gating assumption. Each doc gets a changelog row dated when this lands.

## Implementation Steps

### Step 1: `CLAUDE.md` revisions
**File:** `CLAUDE.md`
**Action:** Modify

Specific edits, in order:

- **"Tech Stack" line** (line ~18): change from
  > Angular 17+ ... plus a thin Node.js BFF proxy (Express or Fastify) that holds the orchestrator API key and forwards calls.

  to:
  > Angular 17+ (standalone components, signals), TypeScript (strict), Tailwind CSS. The SPA calls the orchestrator directly; deployment is gated by network position (see `docs/ARCHITECTURE.md` § "Interim security posture"). Real per-operator auth is deferred to FEAT-004.

- **"Repo Type"** (line ~19): change from "Single Angular SPA + colocated BFF proxy (single repo, two deployable processes)." to "Single Angular SPA. One deployable process."

- **"Quick Reference > Common Commands"** (npm scripts table): drop `bff:dev`. Update `dev` to "runs the SPA only." Update `start` to "ng serve." Update `build` to "ng build." T-029's local-environment-setup subsection should already be in place.

- **"Key Directories" tree**: delete the `bff/` block entirely. The remaining tree is SPA-only.

- **"Code Style & Conventions > BFF (Node)"** subsection (lines ~99-103): delete the entire subsection. Replace with one line under a renamed "Operator Gate" subsection:
  > **Operator Gate (SPA-side).** Login compares the typed value against `environment.operatorPassphrase` and writes `'true'` to `sessionStorage` under `ao.operator.unlocked`. The route guard reads the flag. No backend; no real auth; the network is the gate.

- **"Patterns to Follow"**: drop the BFF-related bullets. Keep "Wire shapes are camelCase end-to-end" but drop "through the BFF" — change to "from the orchestrator into TS interfaces."

- **"Anti-Patterns to Avoid"**: replace `Don't ship the API key to the browser. It lives in BFF env only.` with:
  > **`ORCHESTRATOR_API_KEY` ships in the browser by design.** This is acceptable only because the orchestrator deployment is network-gated. If that ever stops being true, this whole posture is broken — see ARCHITECTURE.md "Interim security posture" before assuming otherwise.

  Drop `Don't call the orchestrator directly from the browser.` — that's the new normal.

- **"Error Handling"**: leave; the catalog is unchanged. Drop the line "BFF passes them through unchanged."

### Step 2: `docs/ARCHITECTURE.md` rewrite
**File:** `docs/ARCHITECTURE.md`
**Action:** Modify

- **Component Roles table**: drop the BFF row. SPA row's responsibility list updates: SPA now owns "Auth header attach" and "Operator gate."

- **Data Flow diagram / paragraph**: redraw from `Operator → SPA → BFF → Orchestrator` to `Operator → SPA → Orchestrator`. The trace stream paragraph stays but loses the `pipeline()` BFF reference.

- **Add a new subsection** under "Security" titled **"Interim security posture"**:

  ```markdown
  ### Interim security posture

  The SPA ships `ORCHESTRATOR_API_KEY` in its bundle. This is acceptable only
  because the orchestrator deployment is **not publicly reachable** —
  authentication relies on network position (VPN, internal ingress, or
  equivalent). Anyone who can reach the SPA URL can extract the key from the
  bundle; the assumption is that "anyone who can reach the SPA URL" is already
  the small set of operators we trust.

  **This must be re-confirmed at every deployment topology change.** A public
  ingress, an accidental CORS opening, or moving the orchestrator to a
  reachable host instantly breaks this posture. The only durable fix is real
  per-operator auth at the orchestrator, tracked as FEAT-004.

  Operator activity is not currently auditable per-user; from the
  orchestrator's perspective every operator is the same API key. This is also
  resolved by FEAT-004.
  ```

- **Key Decisions / ADR list**: if `bff/cookie-session.md` (or similar) was adopted, retire it. Add a one-line note that "BFF was retired in FEAT-003."

### Step 3: `docs/api-spec.md` rewrite
**File:** `docs/api-spec.md`
**Action:** Modify

- **Auth section** (rewrite): the SPA attaches `Authorization: Bearer ${ORCHESTRATOR_API_KEY}` directly. There are no SPA-side `/auth/*` endpoints to document because there is no backend.
- **Base URL framing**: the doc was BFF-relative (paths starting `/api/v1/`). Update the heading or intro paragraph to make clear that paths are now relative to the **orchestrator** base URL configured in `src/environments/environment.ts`.
- **Endpoint sections**: change every `/api/v1/<x>` to `/v1/<x>`. The shapes are unchanged.
- **Error Catalog**: unchanged. Note that `unauthenticated` codes now come from the orchestrator (rotated key), not the BFF.

### Step 4: `docs/ui-specification.md` updates
**File:** `docs/ui-specification.md`
**Action:** Modify

- **§ "Behavior: Auth Guard"**: rewrite the bullet list. `core/auth.guard.ts` checks `sessionStorage.getItem('ao.operator.unlocked') === 'true'`. No bootstrap probe; no `/auth/me`.
- **§ "Screen: Login"**: update the description — the form compares against the configured passphrase and writes the gate flag. No network round-trip. The `?reason=expired` banner still shows when the orchestrator returns 401.
- Other screens unchanged.

### Step 5: `docs/stakeholder-definition.md` scope adjustment
**File:** `docs/stakeholder-definition.md`
**Action:** Modify

- **Scope (V1) table**: drop the row that mentions the BFF as a deliverable component (or whatever framing is there).
- **Add a row** to the deferred / out-of-scope table:
  > Per-operator authentication. The orchestrator team owns this; tracked as FEAT-004. Until then the SPA gates only on a shared operator passphrase, and the orchestrator authenticates with a single shared API key bundled in the SPA. See `docs/ARCHITECTURE.md` § "Interim security posture".

### Step 6: Changelog rows on every doc above
**Files:** `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/api-spec.md`, `docs/ui-specification.md`, `docs/stakeholder-definition.md`
**Action:** Modify

Add a row dated when this PR lands (placeholder `2026-MM-DD`):

| File | Suggested wording |
|------|---|
| `CLAUDE.md` | Add a "Changelog" subsection at the bottom if one doesn't exist yet, then: *FEAT-003 — BFF retired; SPA calls the orchestrator directly. Operator gate is now SPA-side (sessionStorage). API key lives in `src/environments/environment.*.ts`.* |
| `docs/ARCHITECTURE.md` | *FEAT-003 — BFF retired. Component Roles, Data Flow, and Security sections rewritten. Added "Interim security posture" subsection naming the network-gating assumption.* |
| `docs/api-spec.md` | *FEAT-003 — Auth section rewritten; SPA attaches Authorization: Bearer directly; paths now `/v1/*` against the orchestrator base URL. `/auth/*` endpoints removed.* |
| `docs/ui-specification.md` | *FEAT-003 — Auth Guard subsection rewritten for sessionStorage-based gate. Login screen updated for no-network-call semantics.* |
| `docs/stakeholder-definition.md` | *FEAT-003 — Scope updated: BFF retired; deferred per-operator auth (FEAT-004) added explicitly.* |

### Step 7: Sanity grep
**Action:** Verify

```bash
git grep -nF '/api/v1/' -- 'docs/*' CLAUDE.md
git grep -nF 'BFF' -- 'docs/*' CLAUDE.md
git grep -nF 'bff:dev' -- 'docs/*' CLAUDE.md
git grep -nF 'cookie session' -- 'docs/*' CLAUDE.md
```

Each should return only changelog mentions.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `CLAUDE.md` | Modify | Tech-stack line, Repo Type, scripts table, key dirs tree, BFF subsection, patterns/anti-patterns. |
| `docs/ARCHITECTURE.md` | Modify | Component Roles, Data Flow, Security + new "Interim security posture." |
| `docs/api-spec.md` | Modify | Auth section rewrite; paths `/v1/*`; drop `/auth/*`. |
| `docs/ui-specification.md` | Modify | Auth Guard subsection + Login screen. |
| `docs/stakeholder-definition.md` | Modify | Scope adjustments. |

## Edge Cases & Risks
- **Reviewers don't notice the new "Interim security posture" subsection.** Bold the subsection in the PR description and quote the load-bearing-assumption sentence verbatim. This is the most important thing the doc surgery adds.
- **Conflicting changelog dates.** If the merge slips across a date boundary, the row date may be off by one. Acceptable; nobody reads changelog dates with that precision.
- **Stale ADR adoption pointer.** `CLAUDE.md` references `carestechs-software-architecture` ADRs. If `bff/cookie-session.md` was adopted there, the entry needs retiring. Check during the PR; defer if the ADR repo is not in scope of this PR.
- **`docs/data-model.md`** is intentionally not touched. Wire shapes haven't changed.

## Acceptance Verification
- [ ] No reference to "BFF" as an active component remains in any of the five files outside changelog rows.
- [ ] `CLAUDE.md` accurately describes the new `npm run dev` (single process, no BFF).
- [ ] `ARCHITECTURE.md` has an "Interim security posture" subsection naming the network-gating assumption explicitly.
- [ ] All five files gain a changelog row.
- [ ] Sanity greps from Step 7 return only changelog mentions.
