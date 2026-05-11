# Architecture

## System Summary

A single-page Angular 17+ application that is the operator console for `carestechs-agent-orchestrator`. The SPA calls the orchestrator directly over HTTP/JSON and NDJSON; there is no backend tier owned by this repo.

This is an **interim architecture**. The orchestrator authenticates with a single static API key bundled into the SPA, which is only acceptable because the orchestrator deployment is not publicly reachable (see § "Interim security posture"). Real per-operator authentication is deferred to FEAT-004.

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | Angular 17+, standalone components only | ADR `angular/standalone-components.md`. NgModules add indirection for no benefit. |
| Component templates | Separate `.html` template files | ADR `angular/separate-template-file.md`. Inline templates lose tooling and review clarity. |
| Component styling | Tailwind CSS only, no component CSS files | ADR `angular/tailwind-no-css.md`. Co-located styling, no specificity wars. |
| Reactive state | Angular Signals for component state, RxJS only for HTTP and complex async | ADR `angular/signals-state.md`. Simpler mental model, fewer subscription leaks. |
| TypeScript | Strict mode, no `any` | ADR `typescript/strict-typescript.md`. Catches errors at the boundary. |
| Module exports | Named exports only (default exports only when Angular `loadComponent` requires them) | ADR `typescript/named-exports.md`. |
| Auth (interim) | API key in the SPA bundle; SPA gates with a sessionStorage passphrase. Network position is the real gate. | See § "Interim security posture". Real auth is FEAT-004. |
| CORS | Orchestrator deployment allows the SPA's origin and the `authorization` request header | Required by the direct-call topology after FEAT-003. |
| Trace transport | NDJSON over HTTP, streamed via `fetch` + `ReadableStream` | Matches the orchestrator's plain-NDJSON trace endpoint. No WebSocket / SSE on either side. |
| API envelope | Orchestrator camelCase + `{ data, meta }` envelope, parsed unchanged | UI matches at the boundary. ADR `api/rest-envelope.md`. |
| Error format | RFC 7807 `application/problem+json` from orchestrator | Stable `code` field is what the UI keys on. |
| Pagination | Offset-based (`page`, `pageSize`) | Matches orchestrator. ADR `api/offset-pagination.md`. |
| Testing | Vitest (unit), Playwright (E2E smokes) | Co-located unit tests; ADR `typescript/vitest-colocated.md`. |
| Design system | `modern-minimal` profile from `carestechs-ui-design` | Operator console prefers calm, content-first density. Sky `#0EA5E9` primary, Poppins/Inter typography, elevated cards. |

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Angular 17+ (standalone components, signals, RxJS where needed), TypeScript strict, Tailwind CSS | Operator UI; single deployable. |
| **Auth (SPA gate)** | `sessionStorage` flag set after the operator types the configured passphrase. No backend. | Keeps casual tab-takeover from being a free action. Not a real authentication boundary. |
| **Auth (SPA → orchestrator)** | `Authorization: Bearer ${orchestratorApiKey}` attached by `ApiClient` and `TraceStreamService` from `environment.*.ts`. | Single static bearer key; orchestrator's current scheme. |
| **Build** | Angular CLI (`ng build`). `environment.prod.ts` is materialized at deploy time from CI secrets. | |
| **Test** | Vitest (unit), Playwright (smoke E2E) using an in-process orchestrator mock. | |
| **Hosting** | Static SPA bundle served by any CDN or static-file server. The orchestrator host must be reachable from operators' browsers and must set CORS allow-headers for the SPA's origin. | |

No database. The SPA is stateless beyond a per-tab `sessionStorage` gate flag.

## Component Architecture

```
┌────────────────────────┐    Bearer API key    ┌──────────────────────────┐
│   Angular SPA          │ ───────────────────▶ │   Orchestrator           │
│   (browser)            │                      │   (HTTP API + NDJSON)    │
│                        │ ◀─ JSON / NDJSON ─── │                          │
└────────────────────────┘                      └──────────────────────────┘
        │
        │ build-time env: orchestratorBaseUrl, orchestratorApiKey, operatorPassphrase
        ▼
  ┌────────────────────┐
  │ static SPA bundle  │
  └────────────────────┘
```

### Component Descriptions

**Angular SPA (`src/`)**
- **Purpose:** Render the operator console — runs list, run detail with live trace, signal form, cancel, start-run.
- **Responsibilities:** Routing, form state, signal-based view models, NDJSON consumption, Tailwind styling, error toasts, operator gate (SPA-side), Authorization header attach on every request.
- **Internal layout:**
  - `app/core/` — singleton services: `ApiClient` (Bearer + base URL from env), `RunsService`/`AgentsService`/`SignalsService`, `TraceStreamService`, `AuthService` (sessionStorage gate), `operator-gate.ts` helpers, `auth-events.ts` (401 → expiry channel).
  - `app/features/` — one folder per route: `runs-list`, `run-detail`, `run-start`, `login`. Each is a standalone component lazy-loaded via `loadComponent`.
  - `app/shared/` — reusable presentational components (`StatusBadge`, `Card`, `EmptyState`, `Spinner`, `Skeleton`, `Modal`, `Toast`, `FullPageError`).
  - `app/models/` — TS interfaces mirroring `docs/data-model.md`.
  - `environments/` — `environment.example.ts` ships; `environment.ts` and `environment.prod.ts` are gitignored and materialized at build/deploy time.

**Orchestrator (external)**
- See `carestechs-agent-orchestrator/docs/ARCHITECTURE.md` and `docs/api-spec.md`. Contract authority lives there.
- Must allow the SPA's origin in CORS and include `authorization, content-type` in `Access-Control-Allow-Headers`. Must allow `OPTIONS` preflight on every method used by the SPA, including the streaming `GET /v1/runs/:id/trace`.

## Data Flow

### Read flow (runs list)

1. Browser → `GET ${orchestratorBaseUrl}/v1/runs?status=paused&page=1&pageSize=20` with `Authorization: Bearer ${orchestratorApiKey}`.
2. Orchestrator returns `{ data: [...], meta: { page, pageSize, total } }`.
3. Angular `RunsService` parses into `RunSummary[]`, exposes via `signal()` to `RunsListComponent`.

### Trace stream flow

1. Browser opens `fetch(${orchestratorBaseUrl}/v1/runs/:id/trace?follow=true, { headers: { Authorization } })`.
2. Orchestrator streams NDJSON; the response is NOT buffered by any reverse proxy in front of it (`X-Accel-Buffering: no` if nginx).
3. SPA consumes via `ReadableStream` reader, splits on `\n`, parses each line as a `TraceRecord`, appends to a signal.
4. UI groups records by `stepNumber`, renders a vertical timeline.

### Signal submit flow

1. User opens a paused run; UI inspects the trace for the last `executor_call` with `state=dispatched` and `mode=human`. Pre-fills `taskId` from its `intake`.
2. User fills `commitSha`, `prUrl`, optional `diff` and `implementationNotes`.
3. Browser → `POST ${orchestratorBaseUrl}/v1/runs/:id/signals` with body `{ name: 'implementation-complete', taskId, payload }`.
4. Orchestrator returns `202` with `meta.alreadyReceived` if duplicate.
5. SPA shows success toast, keeps the trace stream open to watch the run advance.

## Integration Points

| Service | Purpose | Auth Method | Failure Strategy |
|---------|---------|-------------|------------------|
| `carestechs-agent-orchestrator` HTTP API | Source of all data; target of all writes | `Authorization: Bearer ${ORCHESTRATOR_API_KEY}` attached by the SPA | Pass through orchestrator's RFC 7807 errors verbatim. UI shows full-page error if the orchestrator is unreachable after one immediate retry. 401 → operator gate locks, redirect to `/login?reason=expired`. |

No external services beyond the orchestrator. No analytics, no telemetry to third parties in v1.

## Security Architecture

### Interim security posture

The SPA ships `ORCHESTRATOR_API_KEY` in its bundle. This is acceptable **only because the orchestrator deployment is not publicly reachable** — authentication relies on network position (VPN, internal ingress, or equivalent). Anyone who can reach the SPA URL can extract the key from the bundle; the assumption is that "anyone who can reach the SPA URL" is already the small, trusted set of operators.

**This must be re-confirmed at every deployment topology change.** A public ingress, an accidental CORS opening to the world, or moving the orchestrator to a reachable host instantly breaks this posture. The only durable fix is real per-operator authentication at the orchestrator, tracked as FEAT-004.

Operator activity is not currently auditable per-user; from the orchestrator's perspective every operator looks like the same API key. This is also resolved by FEAT-004.

### Other properties

- **Operator gate (SPA-side):** A `sessionStorage` flag is set when the operator types the configured passphrase. Per-tab, dies on tab close. **Not real authentication** — the network is the real gate. The passphrase value is in the bundle alongside the API key.
- **Authorization model:** Single role in v1 — any operator who can reach the SPA can read and write everything the orchestrator exposes. RBAC is out of scope.
- **Data protection:** No PII handled by the SPA. Trace payloads can include diffs and PR URLs; treat as confidential at rest. TLS termination at the orchestrator's ingress.
- **Bundle-leak gate:** `scripts/check-no-secrets-in-bundle.sh` runs as `npm run build`'s `postbuild`. After FEAT-003 it forbids nothing by default (the API key and passphrase are *expected* in the bundle). The script keeps the `scan_forbidden` hook so future genuinely-must-not-bundle secrets can be registered with one line.
- **CORS:** Orchestrator must allow the SPA's origin and `authorization` / `content-type` headers, and respond to `OPTIONS` preflight including on the streaming trace endpoint.
- **Audit trail:** Not implemented in v1. Tracked under FEAT-004.

## Deployment

The SPA ships as a single nginx-based container.

- **Image:** multi-stage build (`node:20-alpine` builder → `nginx:alpine` runtime). See `Dockerfile`.
- **Compose:** `docker-compose.prod.yml` joins the external `devtools-infra` network and binds **loopback only** on `127.0.0.1:4200:80`. The loopback bind is **part of** the network-gated security posture (see § "Interim security posture") — operators on the host reach the SPA; the world cannot.
- **Build args:** `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY`, `OPERATOR_PASSPHRASE` are passed at build time and materialize `src/environments/environment.prod.ts` before `ng build`. Locked in at build time (rather than fetched at runtime via a `/config.json`) per FEAT-003 T-029 — every env-config change requires a rebuild. **The build args land in the image's layer history** (visible via `docker history`); do not push these images to a shared registry without threat-model review.
- **CSP:** nginx adds a starter Content-Security-Policy with `'unsafe-inline'` on `script-src` because Angular's zone.js runtime synthesizes inline event handlers. Intentionally permissive for v1; tighten in a follow-up after observing live behavior in report-only mode. The orchestrator base URL is substituted into the CSP's `connect-src` at image build time via `sed`, not at container startup.
- **Liveness vs readiness:**
  - **Liveness** is the docker `HEALTHCHECK` defined in the `Dockerfile` — `wget` the index and confirm `<app-root>` is present. Cheap and fast.
  - **Readiness** (can the SPA actually reach the orchestrator with CORS) is `scripts/smoke-prod.sh`, operator-run after `docker compose up`. The docker healthcheck cannot prove readiness; the smoke script closes the gap.
- **No reverse proxy or TLS termination** lives inside this container. Whatever fronts it handles those, if needed.

## AI Task Generation Notes

> These notes help AI assistants generate technically correct tasks.

- **The SPA owns no backend.** New runtime concerns must be solved client-side, in the orchestrator, or as part of FEAT-004 (real auth). Do not propose a new BFF.
- **Follow the defined data flow.** New screens read through services in `app/core/`; services own HTTP; HTTP goes to the orchestrator directly with a Bearer header attached by `ApiClient`.
- **Use only listed technologies** unless proposing an architectural change (which needs an ADR adoption from `carestechs-software-architecture`).
- **Honor the interim security posture.** Never put new secrets into `environment.*.ts` without checking whether they should ship in the bundle. The bundle-leak gate is the catch-all.
- **Conform to ADRs.** When in doubt, the ADRs in `carestechs-software-architecture/adrs/angular/` and `adrs/typescript/` win.
- **Conform to the design system.** When in doubt, the `modern-minimal` profile and DDRs in `carestechs-ui-design/` win.

## Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial architecture from orchestrator-ui-starter.md, Angular ADRs, and modern-minimal profile. |
| 2026-05-09 | FEAT-001 audit — "API key never reaches browser" property is now mechanically enforced by `scripts/check-no-secrets-in-bundle.sh` (run from `npm run build` `postbuild`) and a Playwright assertion in `e2e/critical-path.spec.ts` that no browser-initiated request carries an `Authorization` header. |
| 2026-05-10 | FEAT-002 — `features/run-start/` activated (route + form + submit). `RunsService.startRun` extends the existing service. Lighthouse a11y CI gate now also covers `/runs/new` (≥ 0.95). |
| 2026-05-10 | FEAT-003 — BFF retired. SPA calls the orchestrator directly with a Bearer header. Component Roles, Data Flow, and Security sections rewritten. New **Interim security posture** subsection names the network-gating assumption explicitly. Bundle-leak gate inverted (API key and passphrase now expected in the bundle; framework hook preserved). E2E secret-capture assertions inverted to match. |
| 2026-05-11 | FEAT-005 — Containerized deployment landed. New **Deployment** subsection names the multi-stage build, the loopback bind (as part of the network-gating story), the build-args-in-layer-history caveat, the starter CSP, and the liveness/readiness split (`scripts/smoke-prod.sh` is the readiness probe; `scripts/check-orchestrator-cors.sh` is the CORS diagnostic). |
