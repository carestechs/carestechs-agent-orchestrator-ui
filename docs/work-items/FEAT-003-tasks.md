# FEAT-003 — Implementation Tasks

**Feature:** [FEAT-003 — Drop the BFF; SPA calls the orchestrator directly](./FEAT-003-drop-bff-direct-orchestrator.md)
**Workflow:** standard (inherited)
**Generated:** 2026-05-10

---

## Foundation

### T-029: Angular environment files for orchestrator base URL, API key, and operator passphrase

**Type:** Frontend + DevOps
**Workflow:** standard
**Complexity:** S
**Dependencies:** None

**Description:**
Introduce `src/environments/environment.ts` (dev) and `src/environments/environment.prod.ts` (prod) exporting a typed `environment` object: `{ orchestratorBaseUrl: string; orchestratorApiKey: string; operatorPassphrase: string; production: boolean; }`. Wire the prod file into `angular.json`'s `production` configuration via `fileReplacements`. Document the local-dev recipe in `CLAUDE.md` (point at the e2e upstream mock or a local orchestrator). Do **not** commit real secrets — provide an `environment.example.ts` and gitignore the actual `environment.ts`.

**Rationale:**
Every other task — `ApiClient` rewire, login gate, e2e fixture — consumes this config. Splitting it out first keeps the rest of the PRs reviewable and gives ops one obvious place to land the deploy-time values.

**Acceptance Criteria:**
- [ ] `environment.example.ts` is checked in with placeholder values; `environment.ts` and `environment.prod.ts` are in `.gitignore`.
- [ ] `angular.json` `production` configuration uses `fileReplacements` to swap in `environment.prod.ts` at build time.
- [ ] A typed `environment` object is importable from `src/environments/environment` and TypeScript strict-mode passes when consumed.
- [ ] `CLAUDE.md` documents how to populate the env files for local dev (orchestrator URL, API key value, passphrase) and explicitly notes "API key is in the bundle by design — see ARCHITECTURE.md interim posture."
- [ ] `npm run build` succeeds against a local placeholder `environment.prod.ts`.

**Files to Modify/Create:**
- `src/environments/environment.example.ts` — committed template.
- `src/environments/environment.ts` — gitignored; created locally.
- `src/environments/environment.prod.ts` — gitignored; populated at deploy.
- `angular.json` — `fileReplacements` in `production` configuration.
- `.gitignore` — add the two real env files.
- `CLAUDE.md` — local-dev section update.

**Technical Notes:**
- Angular's classic `environment.ts` mechanism is fine; no need for `@ngx/env` runtime fetch.
- TypeScript strict mode: type `environment` as a `Readonly<EnvironmentConfig>` with no optional fields — missing values must fail the build, not silently produce `undefined` requests.

---

## Frontend

### T-030: Rewire `ApiClient` and `TraceStreamService` to call the orchestrator directly

**Type:** Frontend
**Workflow:** standard
**Complexity:** M
**Dependencies:** T-029

**Description:**
Update `src/app/core/api-client.ts` and `src/app/core/trace-stream.service.ts` to:
- Build URLs as `${environment.orchestratorBaseUrl}/v1/*` instead of `/api/v1/*`.
- Attach `Authorization: Bearer ${environment.orchestratorApiKey}` on every outbound request.
- Drop `withCredentials: true` (no cookie session anymore).
- Continue handling RFC 7807 problem-details exactly as today.

The auth-expiry channel (`auth-events.ts` → `notifyAuthExpired()` on 401) is no longer triggered by the BFF — but the orchestrator can still return 401 if the API key is rotated or revoked. Keep the channel; redirect to `/login?reason=expired` with the same UX.

**Rationale:**
Closes the load-bearing change in the migration: the SPA now talks to the orchestrator with no proxy in the middle. Everything downstream (login rewire, BFF deletion) becomes safe once this lands and tests pass.

**Acceptance Criteria:**
- [ ] All HTTP calls go to `environment.orchestratorBaseUrl`. No SPA code references `/api/v1/`.
- [ ] Every request carries `Authorization: Bearer <api-key>`.
- [ ] No request carries `Cookie` or has `credentials: 'include'` / `withCredentials: true`.
- [ ] A 401 from the orchestrator still triggers the existing auth-expiry redirect.
- [ ] `RunsService`, `AgentsService`, `SignalsService`, and `TraceStreamService` unit tests pass with no behavioral change to consumers.
- [ ] An `ApiClient` test asserts the `Authorization` header is set to the env-configured value (do not regress this — it's the new contract).

**Files to Modify/Create:**
- `src/app/core/api-client.ts` — base URL + auth header + no credentials.
- `src/app/core/api-client.spec.ts` — header assertions.
- `src/app/core/trace-stream.service.ts` — same migration for the `fetch`-based stream.
- `src/app/core/trace-stream.service.spec.ts` — header assertions.
- `src/app/core/auth-events.ts` — leave as-is (channel still exists), but document its new trigger (orchestrator 401, not BFF 401).

**Technical Notes:**
- Watch out for the trace stream: `fetch` defaults to `credentials: 'same-origin'`. When the URL is now cross-origin (orchestrator on a different host), `same-origin` will already not send cookies, so explicit changes may not be needed — but the `Authorization` header still must be added.
- CORS preflight: the SPA will issue `OPTIONS` requests for any non-simple POSTs. Confirm the orchestrator's `Access-Control-Allow-Headers` includes `authorization` and `content-type`.
- Do NOT log the API key. Keep the existing redact list philosophy.

---

### T-031: Replace cookie-session login with a SPA-side passphrase gate

**Type:** Frontend
**Workflow:** standard
**Complexity:** M
**Dependencies:** T-029

**Description:**
The login flow currently posts to `/auth/login` (BFF) and relies on a cookie session. Migrate it to a purely SPA-side gate:
- Login form compares the typed value against `environment.operatorPassphrase`. On match, write `'true'` to `sessionStorage` under a known key (e.g., `ao.operator.unlocked`). On mismatch, show the same "invalid-passphrase" inline error as today.
- `authGuard` checks the `sessionStorage` flag instead of calling `GET /auth/me`.
- `AuthService.login`/`logout` collapse to read/write helpers around `sessionStorage`. No HTTP.
- The `?reason=expired` query param (from a 401) clears the flag and brings the user back to the login screen — same UX as today.
- Keep the existing `safe-redirect.ts` whitelist exactly as-is for `?redirect=` handling.

**Rationale:**
The brief locked in the SPA-side gate decision. This task implements it without touching `ApiClient` (T-030's surface) or BFF deletion (T-032's surface), keeping the diff focused.

**Acceptance Criteria:**
- [ ] `LoginComponent` no longer makes any HTTP call. Submit checks `environment.operatorPassphrase` synchronously.
- [ ] On valid passphrase, `sessionStorage.setItem('ao.operator.unlocked', 'true')` is called and the user navigates to `?redirect` (sanitized) or `/runs`.
- [ ] On invalid, the same inline error from FEAT-001 is shown — no toast.
- [ ] `authGuard` allows the route iff `sessionStorage.getItem('ao.operator.unlocked') === 'true'`.
- [ ] A 401 mid-session clears the flag, redirects to `/login?reason=expired`, and the existing expired-banner shows.
- [ ] All login + auth-guard unit tests pass with the rewired implementation.
- [ ] No code references `/auth/login`, `/auth/logout`, or `/auth/me`.

**Files to Modify/Create:**
- `src/app/features/login/login.component.ts` / `.html` / `.spec.ts` — sync passphrase check.
- `src/app/core/auth.service.ts` / `.spec.ts` — `sessionStorage`-backed.
- `src/app/core/auth.guard.ts` / spec if any — read flag.
- `src/app/core/auth-events.ts` — `notifyAuthExpired` clears the flag in addition to navigating.

**Technical Notes:**
- Tests can manipulate `sessionStorage` directly via jsdom — no extra mocking layer needed.
- Avoid reading `environment.operatorPassphrase` outside the login component; one place, one comparison.
- The flag key (`ao.operator.unlocked`) is intentionally banal and prefixed; namespacing keeps it from colliding with whatever else operators paste into the same browser tab.

---

## Cleanup

### T-032: Delete `bff/` and the BFF-only build/dev plumbing

**Type:** DevOps
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-030, T-031

**Description:**
Once nothing in the SPA calls `/api/v1/*` or `/auth/*` (T-030 + T-031), delete the BFF in full:
- Remove the `bff/` directory.
- Remove `proxy.conf.json` and the `--proxy-config` flag from `npm start`.
- Remove the BFF tsc step from `npm run build`.
- Remove `npm run bff:dev` from `package.json` scripts; update `dev` to start only the SPA.
- Remove BFF-only dependencies: `fastify`, `@fastify/cookie`, `nodemon`. Verify nothing else depends on them.
- Remove BFF-only env vars from any documentation or CI workflow boilerplate.

**Rationale:**
This is the deletion the migration exists for. Keeping it isolated in its own task makes the deletion diff trivially review-able — anything still referencing the BFF after this task means a prerequisite was incomplete.

**Acceptance Criteria:**
- [ ] `bff/` directory does not exist.
- [ ] `npm run dev` starts only `ng serve` (no concurrent BFF process).
- [ ] `npm run build` produces a SPA bundle and exits successfully.
- [ ] `npm test` and `npm run e2e` still pass (e2e fixture changes land in T-033 — order this task before T-033).
- [ ] `package.json` no longer lists `fastify`, `@fastify/cookie`, or `nodemon`.
- [ ] No file in the repo greps positive for `bff/`, `proxy.conf.json`, or `bff:dev` after this task.

**Files to Modify/Create:**
- `bff/` (delete).
- `proxy.conf.json` (delete).
- `package.json` — `scripts.dev`, `scripts.start`, `scripts.build`, `devDependencies`.

**Technical Notes:**
- `concurrently` may also become unused. If so, drop it. Otherwise keep it (e.g., if `npm run dev` still runs more than one process for the e2e mock).
- This task technically can land before T-033, but the e2e suite will fail in CI until T-033 also lands. Either land them together in one PR or land T-032 with `npm run e2e` skipped on the branch (annotated) and T-033 right after.

---

## Testing

### T-033: Refactor Playwright e2e for the direct-call topology

**Type:** Testing
**Workflow:** standard
**Complexity:** M
**Dependencies:** T-032

**Description:**
The e2e suite currently boots the upstream mock + BFF + SPA. After T-032 there's no BFF; the SPA must call the upstream mock directly. Update:
- `playwright.config.ts` — `webServer` array drops the BFF entry.
- Each spec's login flow uses the new SPA-side passphrase (selectors stay the same; the network call disappears).
- The `installSecretCapture` helper in `critical-path.spec.ts` **inverts**: assert that every request DOES carry `Authorization: Bearer <expected-key>`, and that nothing else (e.g., the operator passphrase) leaks. Drop the "no Authorization header" assertion entirely — it was meaningful with the BFF, meaningless without it.
- Upstream-mock handler paths shift: the SPA now hits `/v1/*` directly (no `/api/v1/*` BFF prefix, but the mock's paths were already `/v1/*`, so this is mostly a base-URL setting change).
- The `e2e/global-setup.ts` may need to expose the upstream-mock URL to the SPA's environment so the production build hits the right place.

**Rationale:**
The whole point of FEAT-003 is the new topology; the e2e suite is the only thing that proves it actually works.

**Acceptance Criteria:**
- [ ] Playwright config boots only upstream mock + SPA static server.
- [ ] All three specs (`critical-path`, `cancel-run`, `start-run`) pass against the new topology.
- [ ] Authorization-header assertion is **inverted** — present, equals the configured key, and the value does not appear anywhere unexpected (request URLs, console messages).
- [ ] Three consecutive local runs are clean.

**Files to Modify/Create:**
- `playwright.config.ts` — `webServer` array.
- `e2e/global-setup.ts` — pass orchestrator URL to the SPA env.
- `e2e/critical-path.spec.ts` — flip secret capture; drop BFF expectations.
- `e2e/cancel-run.spec.ts` — same login update.
- `e2e/start-run.spec.ts` — same login update.
- `e2e/fixtures/upstream-mock.ts` — drop the `/__test/reset` semantics that depended on the BFF, if any (probably none — the mock is independent).

**Technical Notes:**
- The static server (`scripts/serve-spa-with-proxy.mjs`) currently proxies `/api` and `/auth` to the BFF. With no BFF those proxies become dead routes — strip them from the script. The script becomes a plain static server with SPA fallback.

---

## DevOps

### T-034: Invert the bundle-leak CI gate; simplify the Lighthouse workflow

**Type:** DevOps
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-030, T-032

**Description:**
Two CI gate updates that share a PR because they're both consequences of the BFF disappearing:

1. **Bundle-leak gate inversion.** `scripts/check-no-secrets-in-bundle.sh` currently fails when it finds `ORCHESTRATOR_API_KEY` value or the literal `Authorization: Bearer` in `dist/spa/browser`. After T-030, the API key is *expected* to be present — so the gate must invert. New rules:
   - **Forbidden in bundle:** the operator passphrase value, any `SESSION_SECRET`-shaped placeholder, anything matching common-secret regex (TBD a small allow-list approach).
   - **Allowed in bundle:** the API key value (it's there by design now).
   - Gate must still fail loud if forbidden strings appear.
2. **Lighthouse workflow simplification.** `.github/workflows/lighthouse.yml` boots three services (upstream mock, BFF, SPA static server). After T-032 there are only two. Remove the BFF boot block, the BFF env vars (`ORCHESTRATOR_API_KEY`, `SESSION_SECRET`, etc. — they live in the SPA env now), and the `wait-on http-get://localhost:4000/auth/me` line. Update CHROME_PATH passthrough as-is.

**Rationale:**
The bundle-leak inversion is **load-bearing** — without it, the gate fails on the first PR after T-030 (API key is now in the bundle). The Lighthouse simplification is opportunistic but trivially included since the workflow file is already being touched.

**Acceptance Criteria:**
- [ ] `scripts/check-no-secrets-in-bundle.sh` passes on a built bundle that contains the configured API key.
- [ ] The same script fails when fed a bundle with the operator passphrase value present (smoke test in CI or local).
- [ ] `.github/workflows/lighthouse.yml` boots only `upstream-mock` + `lhci:serve`; no BFF references remain.
- [ ] The Lighthouse run still produces all four URL scores ≥ 0.95.

**Files to Modify/Create:**
- `scripts/check-no-secrets-in-bundle.sh` — invert assertions.
- `.github/workflows/lighthouse.yml` — drop BFF boot.
- `.github/workflows/ci.yml` (if it boots a BFF for unit/e2e — it shouldn't, but verify).

**Technical Notes:**
- Pick the bundle-leak rules deliberately. "Anything that looks like a secret" is a tarpit; start with explicit forbidden values (passphrase, `SESSION_SECRET` if you can name it) and a small list of regex patterns (`Bearer [a-zA-Z0-9._-]{32,}` would falsely fire on the bundled API key — exclude the configured value explicitly).

---

## Documentation

### T-035: Doc surgery — ARCHITECTURE, api-spec, ui-spec, CLAUDE.md, stakeholder definition

**Type:** Documentation
**Workflow:** standard
**Complexity:** S
**Dependencies:** T-032 (so docs describe reality, not aspiration)

**Description:**
This is the largest doc update of any FEAT to date. After all the above tasks land, walk every authoritative doc and rewrite the BFF mentions:

- **`CLAUDE.md`** — drop "BFF proxy" from the tech-stack line; remove the `bff/` row from the Key Directories tree; delete the entire "BFF (Node)" subsection under "Code Style & Conventions"; remove `Don't ship the API key to the browser` from anti-patterns and replace with a one-line note about the documented interim posture; update the `npm run dev` description.
- **`docs/ARCHITECTURE.md`** — rewrite "Component Roles" (no BFF row), redraw "Data Flow" as `Operator → SPA → Orchestrator`, and add a new explicit subsection "**Interim security posture**" naming the network-gating assumption from the brief.
- **`docs/api-spec.md`** — Auth section rewritten: SPA attaches `Authorization: Bearer ${ORCHESTRATOR_API_KEY}` directly. Endpoint paths still `/v1/*`; base URL is now the orchestrator. Drop the `/auth/*` BFF endpoints section entirely.
- **`docs/ui-specification.md`** — Auth Guard subsection rewritten to describe the `sessionStorage` flag. Login screen description updated for "no network call."
- **`docs/stakeholder-definition.md`** — Scope table loses the "BFF" component row; add a "Deferred: per-operator auth (FEAT-004)" row.
- **Changelog rows** dated when this lands on every doc above.

**Rationale:**
Doc accuracy is part of the migration's definition of done. CLAUDE.md is the most visible — every future task generation reads it.

**Acceptance Criteria:**
- [ ] No reference to the BFF as an active component remains in any doc except the changelog rows.
- [ ] `CLAUDE.md` accurately describes the new `npm run dev` and the env-file workflow.
- [ ] `ARCHITECTURE.md` has an "Interim security posture" subsection naming the network-gating assumption.
- [ ] All four authoritative docs gain a changelog row dated correctly.
- [ ] A grep for `/api/v1/`, `BFF`, `bff:dev`, `proxy.conf.json` in `docs/` and `CLAUDE.md` returns only changelog mentions.

**Files to Modify/Create:**
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/api-spec.md`
- `docs/ui-specification.md`
- `docs/stakeholder-definition.md`

**Technical Notes:**
- Changelog rows should be specific. "FEAT-003 — BFF deleted; SPA calls orchestrator directly with build-time API key. Interim posture: network-gated deployment." — concise, but names the load-bearing assumption.

---

## Summary

**Total tasks:** 7
- Frontend + DevOps: 1 (T-029 — env files)
- Frontend: 2 (T-030 — `ApiClient` rewire, T-031 — passphrase gate)
- DevOps: 2 (T-032 — BFF deletion, T-034 — CI gates)
- Testing: 1 (T-033 — e2e refactor)
- Documentation: 1 (T-035 — doc surgery)

**Complexity distribution:** S × 4 (T-029, T-032, T-034, T-035), M × 3 (T-030, T-031, T-033). No L/XL — every task is reviewable in one sitting.

**Critical path:** T-029 → (T-030 ∥ T-031) → T-032 → (T-033 ∥ T-034) → T-035.
- T-030 and T-031 can land in parallel after T-029 (they touch disjoint files).
- T-033 and T-034 can land in parallel after T-032 (one is e2e, the other is CI gates).
- T-035 lands last so the docs reflect reality rather than aspiration.

**Risks / open questions surfaced during analysis:**
- **CORS preflight on the orchestrator's response headers.** The brief says CORS is confirmed for the SPA origin. T-030 needs to also confirm that `Access-Control-Allow-Headers` includes `authorization` and `content-type` for non-simple POSTs, and that `OPTIONS` is allowed on the streaming `/v1/runs/:id/trace` endpoint. A `curl --no-buffer` smoke against the deployed orchestrator before locking T-030 is a 5-minute check that prevents 5 hours of debugging.
- **`auth-events.ts` channel naming.** The channel was created for "BFF returns 401 → log out." Renaming it to "orchestrator returns 401" or "session-expired" is a wash; the existing name still describes what it does (signals a session expiry). Recommend leaving it alone; flag if it confuses future readers.
- **The bundle-leak gate's allow-list.** Once we've inverted it, future PRs that add new strings to `environment.ts` (e.g., a feature-flag value) might trip false positives unless we update the allow-list. T-034's plan should include a one-line comment in the script explaining how to update it.
- **Order of T-032 vs. T-033.** Strictly, T-032 must precede T-033 (no BFF to talk to means e2e is broken). Practically, landing them together in one PR is reasonable. Plan generator/reviewer to decide based on PR size when we get there.
- **Audit trail loss is real.** Today nothing logs operator activity, but the BFF was the natural place to add it. After this migration the orchestrator team owns that observability. Flag in T-035's `ARCHITECTURE.md` revision.
