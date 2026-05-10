# FEAT-005 — Implementation Tasks

**Feature:** [FEAT-005 — Containerized deployment](./FEAT-005-containerized-deployment.md)
**Workflow:** standard (inherited)
**Generated:** 2026-05-10

---

## Foundation

### T-036: Verify orchestrator CORS for the operator-local origin

**Type:** DevOps / verification
**Workflow:** standard
**Complexity:** S
**Dependencies:** None

**Description:**
Before any container work proceeds, verify that the deployed orchestrator's CORS configuration accepts `http://127.0.0.1:4200` with `Authorization` in `Access-Control-Allow-Headers` and answers `OPTIONS` preflight on the streaming `GET /v1/runs/:id/trace` endpoint. Record the verification as a script that can be re-run on every deployment change.

**Rationale:**
The whole FEAT-005 stack falls over at the browser if any of these are wrong. A 5-minute curl now prevents a Saturday afternoon of debugging.

**Acceptance Criteria:**
- [ ] `scripts/check-orchestrator-cors.sh` exists and exits non-zero if any of the three preflight checks fail: simple GET, POST-with-content-type, OPTIONS on the trace endpoint.
- [ ] The script reads `ORCHESTRATOR_BASE_URL` from env and uses `http://127.0.0.1:4200` as the test origin.
- [ ] Running the script locally against the deployed orchestrator returns "OK: CORS posture acceptable for FEAT-005."
- [ ] If the script fails, the failure mode names exactly which header / method / endpoint is wrong, so the orchestrator team has a single piece of paper to act on.

**Files to Modify/Create:**
- `scripts/check-orchestrator-cors.sh` — new.

**Technical Notes:**
- The streaming endpoint is the trap. CORS often gets allowed for the JSON endpoints by reflex but `OPTIONS` on `/trace` is missed because nobody manually tests it. Hit it explicitly.
- Use `curl -s -o /dev/null -w '%{http_code}'` for a clean exit-code-based assertion.
- Do not bake in a specific run id; the OPTIONS preflight against `/v1/runs/anything/trace` is sufficient — the orchestrator doesn't dereference the path on preflight.

---

## Build

### T-037: Multi-stage Dockerfile + `.dockerignore` + `nginx.conf`

**Type:** DevOps
**Workflow:** standard
**Complexity:** M
**Dependencies:** T-036

**Description:**
Author the multi-stage build (`node:20-alpine` builder → `nginx:alpine` runtime) and the nginx config that fronts the bundle. Builder stage takes `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY`, `OPERATOR_PASSPHRASE` as build args, materializes `src/environments/environment.prod.ts` via a heredoc, then runs `npm run build`. Runtime stage copies `dist/spa/browser/` into `/usr/share/nginx/html/` and `nginx.conf` into the right place. The runtime stage also runs the `postbuild` secret-scan one more time as a belt-and-braces guard.

**Rationale:**
This is the deliverable that turns the SPA into something operators can pull and run.

**Acceptance Criteria:**
- [ ] `docker build -t carestechs-ao-ui --build-arg ORCHESTRATOR_BASE_URL=http://127.0.0.1:8000 --build-arg ORCHESTRATOR_API_KEY=test --build-arg OPERATOR_PASSPHRASE=test .` completes in under 3 minutes on a warm cache.
- [ ] Final image is `nginx:alpine`-based and under ~50 MB compressed.
- [ ] `index.html` is served with `Cache-Control: no-store`.
- [ ] Hashed assets (`chunk-*.js`, `chunk-*.css`) are served with `Cache-Control: public, max-age=31536000, immutable`.
- [ ] `try_files $uri /index.html;` SPA fallback works — `curl http://localhost:80/runs/anything` returns the index.
- [ ] gzip + brotli enabled for `text/css`, `application/javascript`, `application/json`, `image/svg+xml`.
- [ ] Baseline security headers present: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a starter CSP (`default-src 'self'; connect-src 'self' ${ORCHESTRATOR_BASE_URL}; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:;`). CSP is permissive on `'unsafe-inline'` for Angular's runtime; documented as a starter.
- [ ] `.dockerignore` excludes `node_modules`, `dist`, `coverage`, `.lighthouseci`, `e2e/test-results`, `playwright-report`, `.angular`, `.git`, `src/environments/environment.ts`, `src/environments/environment.prod.ts`.

**Files to Modify/Create:**
- `Dockerfile` — new.
- `nginx.conf` — new.
- `.dockerignore` — new.

**Technical Notes:**
- The builder stage materializes the env file with a heredoc; mirror the CI workflow's pattern verbatim so they don't drift.
- The CSP's `connect-src` template literal needs to be expanded at *image build time*, not at runtime — substitute via `envsubst` in the builder or just bake the value into nginx.conf with `sed`. Keep it simple; document the substitution.
- Don't try to use BuildKit `--secret` mounts in v1. Build args are good enough for the interim posture. Note the upgrade path in `CLAUDE.md`.
- The image's layer history will contain the build args. Make sure the README / `CLAUDE.md` documents this so it doesn't surprise anyone who runs `docker history`.

---

### T-038: `docker-compose.prod.yml` with healthcheck and `devtools-infra` integration

**Type:** DevOps
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-037

**Description:**
Single-service compose file that joins the external `devtools-infra` network, publishes loopback-only on `127.0.0.1:4200:80`, and reports container health via a docker `HEALTHCHECK`. The healthcheck is **liveness** (does nginx respond with the index containing `<app-root>`); readiness is T-039's smoke script.

**Rationale:**
The container has to integrate with the umbrella stack. The umbrella expects health-gated services; without a healthcheck the umbrella won't know if this is alive.

**Acceptance Criteria:**
- [ ] `docker compose -f docker-compose.prod.yml up -d` starts the container.
- [ ] `docker compose -f docker-compose.prod.yml ps` shows `healthy` within 15 seconds of start.
- [ ] The container is reachable at `http://127.0.0.1:4200` from the host; trying `curl http://<host-LAN-ip>:4200` fails (loopback bind).
- [ ] The compose file declares `networks: devtools-infra: external: true` so it joins the umbrella stack's network.
- [ ] `HEALTHCHECK` uses `wget -qO- http://localhost/ | grep -q '<app-root'` (or equivalent) with reasonable interval / retries / start-period.
- [ ] The compose file passes the build args through to the build context so `docker compose build` works without separate `docker build` invocation.

**Files to Modify/Create:**
- `docker-compose.prod.yml` — new.

**Technical Notes:**
- `127.0.0.1:4200:80` is intentional and load-bearing. Do not bind on `0.0.0.0:4200:80` — that breaks the network-gated assumption from FEAT-003's "Interim security posture."
- If the umbrella's `devtools-infra` network doesn't exist yet on the operator's machine, compose fails with a confusing error. T-040's docs section explains this.
- `start_period` should be at least 5s to absorb nginx's startup time on a cold container.

---

## Verification

### T-039: Operator smoke script — readiness probe (CORS + bundle reachability)

**Type:** DevOps / verification
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-038

**Description:**
The docker `HEALTHCHECK` only proves nginx serves the index. It does **not** prove the SPA's runtime can reach the orchestrator (CORS). Add a separate `scripts/smoke-prod.sh` that an operator runs after starting the compose stack: it hits the SPA's index, parses the bundle for the configured orchestrator base URL (sanity check that build args propagated), then does a CORS preflight from a simulated browser `Origin` and a real authenticated request. Exit non-zero on any failure.

**Rationale:**
Liveness ≠ readiness. The umbrella's health gate will report healthy even if CORS is silently misconfigured; operators need a one-line command that catches the misconfig.

**Acceptance Criteria:**
- [ ] `scripts/smoke-prod.sh` exists and exits 0 only when: (1) nginx returns the index containing `<app-root>`, (2) the bundle contains the expected orchestrator base URL, (3) a CORS preflight against the orchestrator from origin `http://127.0.0.1:4200` succeeds, (4) an authenticated `GET /v1/agents` succeeds.
- [ ] Each failed check prints a single specific line: what was wrong and the suggested fix.
- [ ] The script reads `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY` from env (with sensible defaults pointing at `127.0.0.1:8000`).
- [ ] Documented in `CLAUDE.md` as the post-deploy verification step.

**Files to Modify/Create:**
- `scripts/smoke-prod.sh` — new.

**Technical Notes:**
- Do NOT bake the API key into the script. Read from env. The script's job is to call the orchestrator the way a browser would.
- The bundle-base-URL check can use `grep -l "$ORCHESTRATOR_BASE_URL" <(curl http://127.0.0.1:4200/chunk-*.js)`. If the build-arg didn't propagate, the bundle has a placeholder URL and this fails loud.
- Distinguish "container not running" (loud) from "CORS misconfigured" (loud) — they're different fixes.

---

## Documentation

### T-040: Doc surgery — CLAUDE.md container subsection, ARCHITECTURE Deployment, api-spec CORS

**Type:** Documentation
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-037, T-038, T-039 (docs describe what shipped)

**Description:**
Update the authoritative docs with the new container surface and deployment instructions. This is the last task; it lands after the build, compose, and smoke pieces are in place so the docs describe reality.

**Rationale:**
Per `CLAUDE.md`'s documentation-maintenance discipline, deployment-shaped changes belong in `ARCHITECTURE.md`. Per `api-spec.md`'s CORS section, the deployed origin needs explicit naming.

**Acceptance Criteria:**
- [ ] `CLAUDE.md` gains a "Container build & run" subsection under "Quick Reference" listing:
  - the build command with `--build-arg` examples,
  - the `docker compose -f docker-compose.prod.yml up -d` workflow,
  - the post-deploy `scripts/smoke-prod.sh` step,
  - the **build-args-in-layer-history caveat** documented explicitly so it doesn't surprise anyone,
  - a pointer to the upgrade path (BuildKit `--secret` mounts) if/when that becomes warranted.
- [ ] `docs/ARCHITECTURE.md` gains a "Deployment" subsection naming: the multi-stage container, the loopback bind, the relationship to the "Interim security posture" (loopback bind is *part of* the network-gating story), the liveness/readiness split, and the build-time-env decision (and pointer to T-029 for "why").
- [ ] `docs/api-spec.md` § "CORS" lists `http://127.0.0.1:4200` explicitly as the deployed origin the orchestrator must allow.
- [ ] Changelog rows on `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/api-spec.md`, dated when this lands.
- [ ] `docs/work-items/FEAT-005-*.md` status fields stay at `Proposed` (consistent with the FEAT-001/002/003 convention — see the FEAT-002 T-028 PR description for the flag).

**Files to Modify/Create:**
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/api-spec.md`

**Technical Notes:**
- Keep the new sections short. The container is one of the simpler parts of the stack; over-documenting it ages poorly.
- The CSP starter policy is documented in the Dockerfile / nginx.conf themselves (close to the change); `ARCHITECTURE.md` only needs to mention it exists and is intentionally permissive.

---

## Summary

**Total tasks:** 5
- DevOps / verification: 3 (T-036, T-037, T-038, T-039 — three of these four are DevOps)
- Documentation: 1 (T-040)

**Complexity distribution:** S × 4 (T-036, T-038, T-039, T-040), M × 1 (T-037). No L/XL.

**Critical path:** T-036 → T-037 → T-038 → T-039 → T-040. Linear; each task layers on the previous one's output. No meaningful parallelism — the Dockerfile depends on confirmed CORS; the compose file depends on a built image; the smoke script depends on a running compose stack; the docs describe what actually shipped.

**Risks / open questions surfaced during analysis:**
- **`devtools-infra` external network must already exist.** If not, T-038 fails with a confusing error. T-040's docs section instructs operators to create the network if missing (`docker network create devtools-infra`).
- **CSP `'unsafe-inline'` is a starter, not a final policy.** Angular's runtime currently requires it (zone.js patches that synthesize inline event listeners). Plan to tighten in a separate feat after observing live behavior with a stricter policy first via report-only mode.
- **Build args leak into image layer history.** Documented in T-040. Operators who push images to a shared registry must understand this. Upgrade to BuildKit `--secret` mounts is a small follow-up if it ever matters.
- **Liveness vs readiness asymmetry.** Docker reports `healthy` without proving CORS works. T-039's smoke script closes this gap, but it's operator-run not auto-run. If the umbrella stack ever needs an auto-run readiness probe, it would have to live outside this container (or require BuildKit access to the orchestrator at health-check time, which gets ugly fast).
- **Bundle-size-budget surprise.** If a future feat adds web fonts or service workers, the ~50 MB image grows. Today's headroom is comfortable; revisit if it ever feels tight.
