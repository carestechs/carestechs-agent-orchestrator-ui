# FEAT-005 — Containerized deployment (nginx-served SPA, joins devtools-infra)

**Status:** Proposed
**Owner:** TBD
**Workflow:** standard
**Priority:** P1 (unblocks shipping the SPA to operators)

## Summary

Package the SPA as a container that the umbrella `devtools-infra` compose stack can run alongside the orchestrator. Multi-stage build: `node:20-alpine` compiles the Angular bundle, `nginx:alpine` serves it. No backend tier (the BFF was retired in FEAT-003); nginx is pure static + SPA fallback. The container binds loopback on `127.0.0.1:4200:80` so the network-gated security posture is preserved.

## Why

FEAT-003 left the SPA running off `npm run dev` or a one-shot `node scripts/serve-spa.mjs`. Operators need a stable artifact they can pull, run alongside the orchestrator, and have the umbrella's health gate observe. Without a containerized form the post-FEAT-003 architecture isn't actually deployable.

## Load-bearing prerequisite (not UI work, but blocks this)

The orchestrator must allow CORS from the SPA's deployed origin (`http://127.0.0.1:4200` for the operator-local topology) with `authorization` in `Access-Control-Allow-Headers` and `OPTIONS` allowed on every method — **including the streaming `GET /v1/runs/:id/trace` endpoint**. Without this, every browser call fails preflight. The first task in the breakdown must verify this against the deployed orchestrator before any container work proceeds.

## In Scope

- **`Dockerfile`** (repo root) — multi-stage:
  - `builder`: `node:20-alpine`, installs deps with `npm ci`, materializes `src/environments/environment.prod.ts` from build args, runs `npm run build`.
  - `runtime`: `nginx:alpine`, copies `dist/spa/browser/` to `/usr/share/nginx/html/`, copies `nginx.conf`.
- **`nginx.conf`** — static serving with SPA fallback (`try_files $uri $uri/ /index.html;`). Cache headers split: `no-store` for `index.html`, `immutable; max-age=31536000` for hashed assets. gzip + brotli on `text/*`, `application/javascript`, `application/json`. Baseline security headers (`X-Content-Type-Options: nosniff`, a starter CSP that allows same-origin scripts + the orchestrator base URL for `connect-src`).
- **`docker-compose.prod.yml`** — single service, joins the external `devtools-infra` network, publishes `127.0.0.1:4200:80` (loopback only — operators on the host can reach it; the world cannot), with a healthcheck.
- **`.dockerignore`** — exclude `node_modules`, `dist`, `coverage`, `.lighthouseci`, `e2e/test-results`, `playwright-report`, `.angular`, `.git`, `src/environments/environment.ts` / `environment.prod.ts` (the real env files; they're injected via build args).
- **Build-arg contract** — `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY`, `OPERATOR_PASSPHRASE` declared as `ARG` in the builder stage and used to write `environment.prod.ts` via a heredoc step before `ng build`. Document the contract in `docs/ARCHITECTURE.md` and `CLAUDE.md`.
- **Healthcheck** — see the open question below.

## Out of Scope

- Production registry, tagging, and release pipeline. Whatever automation pushes the image is a separate concern.
- Reverse-proxy / TLS termination upstream of nginx. The container assumes whoever fronts it handles TLS if needed.
- Multi-arch images. Single-arch (`linux/amd64`) is fine for v1.
- Secrets-management migration. Build args / docker secrets are good enough for the interim posture.
- CI image build. Operators build locally for now; CI image publishing is FEAT-006 if it ever needs to be its own thing.

## Acceptance Criteria

- [ ] `docker build -t carestechs-ao-ui --build-arg ORCHESTRATOR_BASE_URL=... --build-arg ORCHESTRATOR_API_KEY=... --build-arg OPERATOR_PASSPHRASE=... .` completes and the resulting image is under ~50 MB compressed.
- [ ] `docker compose -f docker-compose.prod.yml up` starts a container that:
  - Listens on `127.0.0.1:4200` and is unreachable from non-loopback addresses.
  - Serves `index.html` at `/` and any unknown path (SPA fallback) with `Cache-Control: no-store`.
  - Serves hashed assets with `Cache-Control: public, max-age=31536000, immutable`.
  - Reports `healthy` to docker after a brief startup window.
- [ ] An operator on the host machine can navigate to `http://127.0.0.1:4200`, sign in with the configured passphrase, and complete the FEAT-001 critical path (list → detail → trace → signal) against the orchestrator.
- [ ] The bundle inside the container contains the **build-arg** values for orchestrator URL, API key, and passphrase — confirming `fileReplacements` worked.
- [ ] The orchestrator's CORS configuration allows `http://127.0.0.1:4200` (verified by a recorded curl preflight check committed under `docs/` or `scripts/`).
- [ ] No new entries in `scripts/check-no-secrets-in-bundle.sh` are needed (the script's allow-nothing default is correct for the new container; any future genuine secrets get added per its existing convention).

## Entity Impact

None.

## API Impact

None directly — but the **orchestrator** must add a CORS allowance for the operator-local origin. That change belongs to the orchestrator repo, not this one. Documented as a prerequisite in `docs/api-spec.md` § "CORS" after FEAT-005 lands.

## UI Impact

None at the screen level. The SPA already builds via T-029's env files and calls the orchestrator directly per T-030.

## Documentation Impact (must update in this feat)

- `CLAUDE.md` — add a "Container build" subsection under "Quick Reference" with the docker build / compose commands and the build-arg contract.
- `docs/ARCHITECTURE.md` — add a "Deployment" subsection naming the container, the loopback bind, and how it relates to the "Interim security posture" assumption (loopback bind is *part of* the network-gating story).
- `docs/api-spec.md` — § "CORS" amended to list the deployed origin (`http://127.0.0.1:4200`) explicitly.
- Changelog rows on each, dated when this lands.

## Risks / Open Questions

- **Healthcheck depth.** A simple `wget -qO- http://localhost/ | grep -q '<app-root'` confirms nginx is up and serving the index, **but not** that the JS bundle parses or that the SPA can reach the orchestrator. That's fine as a *liveness* probe; it overpromises as a *readiness* probe. Recommend two checks: `/` for liveness (cheap, fast), and a separate operator-run smoke (`scripts/smoke-prod.sh`?) for "is CORS actually wired up." Decide explicitly which the umbrella's health gate uses.
- **Build-secret delivery.** Build args land in the image's layer history; anyone with the image can inspect them via `docker history`. Acceptable under the interim posture (the key is in the bundle anyway), but worth naming so it doesn't surprise anyone. Alternative is `--secret` mounts (BuildKit only); slightly stricter, slightly more setup. Recommend build args for v1, flag the upgrade path.
- **CSP starter policy.** A strict CSP can break Angular's runtime (it uses inline-event handlers via zone.js in some code paths). Start permissive (`default-src 'self'; connect-src 'self' ${ORCHESTRATOR_BASE_URL}; script-src 'self' 'unsafe-inline';`) and tighten in a follow-up after observing live behavior. Document this is a starter, not a final policy.
- **Runtime config vs build-time bake.** We chose build-time in FEAT-003 T-029. The container reinforces this: every env-config change requires a rebuild. If the orchestrator URL ever varies across deploys of the same image, revisit (probably with a small `entrypoint.sh` that writes `/usr/share/nginx/html/config.json` from container env, and a tiny SPA bootstrap fetch). Out of scope here; flag for FEAT-006 if it surfaces.
- **`devtools-infra` external network.** This work assumes the network already exists. If not, the compose file falls over with a confusing "network not found" error. T-list's first task includes verifying the network is present and documented.
- **Bundle size budget.** Today's `dist/spa/browser/` is ~330 KB initial + lazy chunks. `nginx:alpine` is ~50 MB. Combined image is comfortably under 100 MB. If we later add fonts or service workers, revisit.

## Traceability

- Stakeholder: `docs/stakeholder-definition.md` § "Constraints" — the network-gated interim posture is the *reason* the loopback-bind container makes sense.
- Architecture: `docs/ARCHITECTURE.md` § "Interim security posture" — this feat operationalizes it.
- API: `docs/api-spec.md` § "CORS" — the prerequisite this feat depends on.
- Conventions: `CLAUDE.md` — gets a new container subsection.
