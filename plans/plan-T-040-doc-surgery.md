# Implementation Plan: T-040 — Doc surgery: container build & deployment

## Task Reference
- **Task ID:** T-040
- **Type:** Documentation
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-036, T-037, T-038, T-039 (docs describe what shipped)
- **Rationale:** Per `CLAUDE.md`'s documentation-maintenance discipline, deployment-shaped changes belong in `ARCHITECTURE.md`. Per `api-spec.md`'s CORS section, the deployed origin needs explicit naming.

## Overview
Three documents get small, targeted updates. Last task; lands after everything else so the docs describe shipped reality.

## Implementation Steps

### Step 1: `CLAUDE.md` — add "Container build & run" subsection
**File:** `CLAUDE.md`
**Action:** Modify

Under "Quick Reference > Common Commands" (or as a new subsection after "Local environment setup"), insert:

```markdown
### Container build & run

After populating `.env` from `.env.example`:

```bash
# Build + run via compose
docker compose -f docker-compose.prod.yml up -d --build

# Verify the stack is actually ready (CORS, bundle URL, authenticated round-trip)
scripts/smoke-prod.sh

# Stop
docker compose -f docker-compose.prod.yml down
```

The container binds **loopback only** on `127.0.0.1:4200`. Reaching it from another LAN host is intentionally impossible — it reinforces the network-gated security posture from `docs/ARCHITECTURE.md` § "Interim security posture".

**Build-args caveat.** `ORCHESTRATOR_API_KEY` and `OPERATOR_PASSPHRASE` are passed as `--build-arg` and end up in the image's layer history. Anyone with the image can read them via `docker history`. This is acceptable under the interim posture (the values are in the bundle anyway), but **do not push these images to a shared registry without a separate threat-model review**. Upgrade path: BuildKit `--secret` mounts; out of scope until it matters.

**If `devtools-infra` network doesn't exist yet:** `docker network create devtools-infra`.

**Re-verify CORS before deploying:** `scripts/check-orchestrator-cors.sh` against the deployed orchestrator. Run this after any orchestrator deployment topology change.
```

Then add to the Changelog at the bottom:

```markdown
| 2026-05-MM | FEAT-005 — Container build & run subsection added. Documents the build-arg contract, the loopback-bind security posture, the `smoke-prod.sh` post-deploy verification step, the `check-orchestrator-cors.sh` CORS re-verification step, and the build-args-in-layer-history caveat. |
```

### Step 2: `docs/ARCHITECTURE.md` — add "Deployment" subsection
**File:** `docs/ARCHITECTURE.md`
**Action:** Modify

After § "Security Architecture" and before § "AI Task Generation Notes", insert:

```markdown
## Deployment

The SPA ships as a single nginx-based container.

- **Image:** multi-stage build (`node:20-alpine` builder → `nginx:alpine` runtime). See `Dockerfile`.
- **Compose:** `docker-compose.prod.yml` joins the external `devtools-infra` network and binds **loopback only** on `127.0.0.1:4200:80`. The loopback bind is **part of** the network-gated security posture (see § "Interim security posture") — operators on the host reach the SPA; the world cannot.
- **Build args:** `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY`, `OPERATOR_PASSPHRASE` are passed at build time and materialize `src/environments/environment.prod.ts` before `ng build`. Locked in at build time (rather than fetched at runtime via a `/config.json`) per FEAT-003 T-029 — every env-config change requires a rebuild. The build args land in the image's layer history; do not push these images to a shared registry without threat-model review.
- **CSP:** nginx adds a starter Content-Security-Policy with `'unsafe-inline'` on `script-src` because Angular's zone.js runtime synthesizes inline event handlers. Intentionally permissive for v1; tighten in a follow-up after observing live behavior in report-only mode.
- **Liveness vs readiness:**
  - **Liveness** is the docker `HEALTHCHECK` — `wget` the index and confirm `<app-root>` is present. Cheap and fast.
  - **Readiness** (can the SPA actually reach the orchestrator with CORS) is `scripts/smoke-prod.sh`, operator-run after `docker compose up`. The docker healthcheck cannot prove readiness; the smoke script closes the gap.
- **No reverse proxy or TLS termination** lives inside this container. Whatever fronts it handles those, if needed.
```

Then add to the Changelog at the bottom:

```markdown
| 2026-05-MM | FEAT-005 — Containerized deployment landed. New "Deployment" subsection names the multi-stage build, the loopback bind (as part of the network-gating story), the build-args-in-layer-history caveat, the starter CSP, and the liveness/readiness split (`scripts/smoke-prod.sh` is the readiness probe). |
```

### Step 3: `docs/api-spec.md` — CORS section names the deployed origin
**File:** `docs/api-spec.md`
**Action:** Modify

In § "CORS", add the deployed origin to the existing list:

- Change: "Allow the SPA's deployed origin (and `http://localhost:4200` for dev)."
- To: "Allow the SPA's deployed origin (`http://127.0.0.1:4200` for the operator-local container topology), and `http://localhost:4200` for dev."

Add a paragraph after the existing CORS bullets:

```markdown
For the operator-local container topology shipped with FEAT-005, the deployed SPA origin is `http://127.0.0.1:4200` (loopback bind on the container host). The orchestrator must allow this origin explicitly, or via wildcard. See `scripts/check-orchestrator-cors.sh` for a curl-based verification check that should be re-run after any orchestrator deployment topology change.
```

Then add to the Changelog at the bottom:

```markdown
| 2026-05-MM | FEAT-005 — CORS section names `http://127.0.0.1:4200` as the operator-local deployed origin. `scripts/check-orchestrator-cors.sh` referenced as the re-verification check. |
```

### Step 4: Sanity grep
**Action:** Verify

```bash
git grep -nF '127.0.0.1:4200' docs/ CLAUDE.md
git grep -nF 'build-arg' CLAUDE.md docs/ARCHITECTURE.md
git grep -nF 'devtools-infra' docs/ARCHITECTURE.md CLAUDE.md
```

- `127.0.0.1:4200` appears in api-spec.md (CORS section), CLAUDE.md (container subsection), ARCHITECTURE.md (deployment subsection).
- `build-arg` appears in CLAUDE.md and ARCHITECTURE.md.
- `devtools-infra` appears in CLAUDE.md (network-create instruction) and ARCHITECTURE.md.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `CLAUDE.md` | Modify | New "Container build & run" subsection; changelog row. |
| `docs/ARCHITECTURE.md` | Modify | New "Deployment" subsection; changelog row. |
| `docs/api-spec.md` | Modify | CORS section names the deployed origin; changelog row. |

## Edge Cases & Risks
- **Forgotten changelog dates.** Each row's `2026-05-MM` placeholder must be filled with the actual merge date before the PR lands. Easy to miss; add to the PR checklist.
- **Documentation describes a build-args caveat that operators might not care about.** Worth keeping. If/when someone pushes an image and the key surfaces in someone else's `docker history`, the documented warning will have been there.
- **The CORS amendment is small but load-bearing.** If we update the docs but forget to actually configure the orchestrator, the deployment fails on the first browser call. That's why `scripts/check-orchestrator-cors.sh` is referenced — the docs point at the verification, not just the contract.

## Acceptance Verification
- [ ] `CLAUDE.md` has the "Container build & run" subsection; docker / smoke commands documented; build-arg caveat present.
- [ ] `docs/ARCHITECTURE.md` has the "Deployment" subsection; loopback bind, build args, CSP, liveness/readiness split, and the network-gating relationship all named.
- [ ] `docs/api-spec.md` § "CORS" mentions `http://127.0.0.1:4200` explicitly and points at the CORS-check script.
- [ ] All three docs have dated changelog rows.
- [ ] Sanity greps from Step 4 return the expected hits.
