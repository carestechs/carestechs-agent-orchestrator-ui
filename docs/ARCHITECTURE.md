# Architecture

## System Summary

A single-page Angular 17+ application backed by a thin Node.js BFF (Backend-for-Frontend) proxy. The SPA is the operator console for `carestechs-agent-orchestrator`; the BFF holds the orchestrator API key, terminates the operator session, and forwards requests upstream — including a streaming pass-through for the NDJSON trace endpoint.

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | Angular 17+, standalone components only | ADR `angular/standalone-components.md`. NgModules add indirection for no benefit. |
| Component templates | Separate `.html` template files | ADR `angular/separate-template-file.md`. Inline templates lose tooling and review clarity. |
| Component styling | Tailwind CSS only, no component CSS files | ADR `angular/tailwind-no-css.md`. Co-located styling, no specificity wars. |
| Reactive state | Angular Signals for component state, RxJS only for HTTP and complex async | ADR `angular/signals-state.md`. Simpler mental model, fewer subscription leaks. |
| TypeScript | Strict mode, no `any` | ADR `typescript/strict-typescript.md`. Catches errors at the boundary. |
| Module exports | Named exports only (default exports only when Angular `loadComponent` requires them) | ADR `typescript/named-exports.md`. |
| Auth secrecy | API key never in browser; held by BFF | Orchestrator is single-key bearer auth; the operator gets a session cookie from the BFF instead. |
| CORS | None upstream; BFF proxies all calls | Orchestrator does not configure CORS. |
| Trace transport | NDJSON over HTTP, streamed via `fetch` + `ReadableStream` | Matches the orchestrator's plain-NDJSON trace endpoint. No WebSocket / SSE on either side. |
| API envelope | Pass through orchestrator camelCase + `{ data, meta }` envelope unchanged | UI matches at the boundary. ADR `api/rest-envelope.md`. |
| Error format | RFC 7807 `application/problem+json` from orchestrator, surfaced verbatim by BFF | Stable `code` field is what the UI keys on. |
| Pagination | Offset-based (`page`, `pageSize`) | Matches orchestrator. ADR `api/offset-pagination.md`. |
| Testing | Vitest (unit, both processes), Playwright (E2E smokes) | Co-located unit tests; ADR `typescript/vitest-colocated.md`. |
| Design system | `modern-minimal` profile from `carestechs-ui-design` | Operator console prefers calm, content-first density. Sky `#0EA5E9` primary, Poppins/Inter typography, elevated cards. |

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Angular 17+ (standalone components, signals, RxJS only where needed), TypeScript strict, Tailwind CSS | Operator UI |
| **BFF** | Node 20+, TypeScript strict, Fastify (or Express), `undici`/`fetch` for upstream calls, `cookie-session` (or equivalent) | Auth termination, API key isolation, NDJSON pass-through |
| **Auth (BFF ↔ browser)** | Session cookie (`httpOnly`, `sameSite=lax`, `secure` in prod). Login form posts a shared operator passphrase, BFF issues session. | Keeps the orchestrator API key off the wire to the browser. |
| **Auth (BFF ↔ orchestrator)** | `Authorization: Bearer ${ORCHESTRATOR_API_KEY}` from env | ADR `api/jwt-bearer-auth.md` style — single static bearer key, as the orchestrator currently uses. |
| **Build** | Angular CLI (`ng build`) for SPA, `tsc` for BFF | |
| **Test** | Vitest (unit), Playwright (smoke E2E) | |
| **Hosting** | Container (Docker) with two processes or two containers — `nginx` serving SPA static + Node BFF behind it | |

No database. The UI is stateless beyond the operator session cookie.

## Component Architecture

```
┌────────────────────────┐    cookie session    ┌──────────────────┐    Bearer API key    ┌────────────────────────┐
│   Angular SPA          │ ───────────────────▶ │   BFF Proxy      │ ───────────────────▶ │   Orchestrator         │
│   (browser)            │                      │   (Node 20+)     │                      │   (HTTP API + NDJSON)  │
│                        │ ◀─ JSON / NDJSON ─── │                  │ ◀─ JSON / NDJSON ─── │                        │
└────────────────────────┘                      └──────────────────┘                      └────────────────────────┘
        │                                                │
        │ static assets                                  │ env: ORCHESTRATOR_BASE_URL,
        ▼                                                │      ORCHESTRATOR_API_KEY,
  ┌────────────┐                                         │      SESSION_SECRET,
  │  nginx /   │                                         │      OPERATOR_PASSPHRASE
  │  ng build  │                                         │
  └────────────┘
```

### Component Descriptions

**Angular SPA (`src/`)**
- **Purpose:** Render the operator console — runs list, run detail with live trace, signal form, cancel, start-run.
- **Responsibilities:** Routing, form state, signal-based view models, NDJSON consumption, Tailwind styling, error toasts, session lifecycle (login/logout).
- **Key Dependencies:** Angular 17+, Tailwind, the BFF (only). Never calls the orchestrator directly.
- **Internal layout:**
  - `app/core/` — singleton services (`HttpClient` wrapper, `AuthService`, `ConfigService`, `TraceStreamService`).
  - `app/features/` — one folder per route: `runs-list`, `run-detail`, `run-start`, `login`. Each is a standalone component lazy-loaded via `loadComponent`.
  - `app/shared/` — reusable presentational components (`StatusBadge`, `Card`, `EmptyState`, `Spinner`, `Skeleton`, `Modal`, `Toast`).
  - `app/models/` — TS interfaces mirroring `docs/data-model.md`.

**BFF Proxy (`bff/`)**
- **Purpose:** Hold the orchestrator API key, expose a session-cookie-protected `/api/v1/*` surface to the SPA, and stream the trace NDJSON through to the browser.
- **Responsibilities:**
  - `/auth/login`, `/auth/logout`, `/auth/me` — operator session.
  - `/api/v1/runs*`, `/api/v1/agents*` — JSON forwarders. Inject `Authorization: Bearer ...` from env. Pass through the orchestrator's `{ data, meta }` envelope unchanged. Pass through `application/problem+json` errors with original status and body.
  - `/api/v1/runs/:id/trace` — NDJSON pass-through using `pipeline()` so the SPA can read line-by-line.
- **Responsibilities it does NOT have:** No business logic, no transformation, no caching, no rate limiting (the orchestrator owns those).
- **Key Dependencies:** Fastify (or Express), `undici`/native `fetch`, `cookie-session`.

**Orchestrator (external)**
- See `carestechs-agent-orchestrator/docs/ARCHITECTURE.md` and `docs/api-spec.md`. Contract authority lives there.

## Data Flow

### Read flow (runs list)

1. Browser → `GET /api/v1/runs?status=paused&page=1&pageSize=20` (cookie attached).
2. BFF validates session, forwards to orchestrator with `Authorization: Bearer ...`.
3. Orchestrator returns `{ data: [...], meta: { page, pageSize, total } }`.
4. BFF streams response body through unchanged.
5. Angular `RunsService` parses into `RunSummary[]`, exposes via `signal()` to `RunsListComponent`.

### Trace stream flow

1. Browser opens `fetch('/api/v1/runs/:id/trace?follow=true')`.
2. BFF opens upstream `fetch` with `Authorization`, then pipes the response body through to the browser response (no buffering).
3. SPA consumes via `ReadableStream` reader, splits on `\n`, parses each line as a `TraceRecord`, appends to a signal.
4. UI groups records by `stepNumber`, renders a vertical timeline.

### Signal submit flow

1. User opens a paused run; UI inspects the trace for the last `executor_call` with `state=dispatched` and `mode=human`. Pre-fills `taskId` from its `intake`.
2. User fills `commitSha`, `prUrl`, optional `diff` and `implementationNotes`.
3. Browser → `POST /api/v1/runs/:id/signals` with body `{ name: 'implementation-complete', taskId, payload }`.
4. BFF forwards. Orchestrator returns `202` with `meta.alreadyReceived` if duplicate.
5. SPA shows success toast, keeps the trace stream open to watch the run advance.

## Integration Points

| Service | Purpose | Auth Method | Failure Strategy |
|---------|---------|-------------|------------------|
| `carestechs-agent-orchestrator` HTTP API | Source of all data; target of all writes | Bearer API key (server-side env, BFF only) | Pass through orchestrator's RFC 7807 errors verbatim. UI shows full-page error if BFF cannot reach upstream after one immediate retry. |

No external services beyond the orchestrator. No analytics, no telemetry to third parties in v1.

## Security Architecture

- **Authentication (operator):** Session cookie issued by BFF after operator submits a shared passphrase. `httpOnly`, `sameSite=lax`, `secure` in production.
- **Authentication (upstream):** Single static bearer API key in BFF env. Never logged, never sent to browser, never written to disk outside env.
- **Authorization:** Single role in v1 — any authenticated operator can read and write everything the orchestrator exposes. RBAC is out of scope.
- **Data Protection:** No PII handled by the UI. Trace payloads can include diffs and PR URLs; treat as confidential at rest. TLS termination at the ingress.
- **API Security:**
  - BFF validates session on every `/api/v1/*` request.
  - Inputs forwarded as-is; the orchestrator validates payload shapes upstream.
  - CSRF: form-encoded writes use double-submit cookie or SameSite=Strict on the session cookie; JSON writes from the SPA are protected by SameSite + custom header check.
  - No CORS — same-origin SPA + BFF.
- **Threats explicitly considered:** API key leakage to browser bundles, session fixation, NDJSON connection exhaustion (BFF caps concurrent open trace streams per session).

## AI Task Generation Notes

> These notes help AI assistants generate technically correct tasks.

- **Respect component boundaries.** SPA never calls the orchestrator. BFF owns no business logic. Adding either is a red flag.
- **Follow the defined data flow.** New screens read through services; services own HTTP; HTTP goes to the BFF.
- **Use only listed technologies** unless proposing an architectural change (which needs an ADR adoption from `carestechs-software-architecture`).
- **Honor the security architecture.** Every new BFF route checks the session cookie. Never log secrets. Never pass orchestrator credentials further than the upstream call.
- **Conform to ADRs.** When in doubt, the ADRs in `carestechs-software-architecture/adrs/angular/` and `adrs/typescript/` win.
- **Conform to the design system.** When in doubt, the `modern-minimal` profile and DDRs in `carestechs-ui-design/` win.

## Changelog

| Date | Change |
|------|--------|
| 2026-05-09 | Initial architecture from orchestrator-ui-starter.md, Angular ADRs, and modern-minimal profile. |
| 2026-05-09 | FEAT-001 audit — "API key never reaches browser" property is now mechanically enforced by `scripts/check-no-secrets-in-bundle.sh` (run from `npm run build` `postbuild`) and a Playwright assertion in `e2e/critical-path.spec.ts` that no browser-initiated request carries an `Authorization` header. |
