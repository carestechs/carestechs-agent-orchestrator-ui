# FEAT-003 — Drop the BFF; SPA calls the orchestrator directly

**Status:** Proposed
**Owner:** TBD
**Workflow:** standard
**Priority:** P1 (architectural simplification; unblocks faster iteration)

## Summary

Delete the Node BFF (`bff/`) and have the SPA call the orchestrator directly. The orchestrator API key moves from a BFF env var to an SPA-side env var consumed at build time (or fetched at runtime from a small config endpoint — to be decided in the implementation plan). This is an **interim** architecture: it is acceptable only because the orchestrator deployment is not publicly reachable. When the orchestrator implements per-operator authentication, this changes again — see FEAT-004 placeholder.

## Why

The BFF was justified by exactly one constraint: a static shared API key cannot ship in a public browser bundle. In practice the BFF has become operational drag — two processes to deploy, signed-cookie session machinery, byte-forwarding quirks (Fastify content-type-parser shadowing the buffer parser, fixed in FEAT-002 T-027), and a body of tests whose only job is to verify "the BFF didn't mangle bytes on the way through." None of this is delivering value to operators.

The team has decided to accept the security tradeoff in the interim because the orchestrator is deployed on a private network. When the orchestrator gains real auth, we revisit; until then, deleting the BFF removes a layer that is now mostly cost.

## Load-bearing Assumption

**The orchestrator deployment is not publicly reachable.** A reachable network position is the only authentication this architecture relies on. If this becomes false at any point — public ingress, accidental CORS opening, dev-cluster exposure — the API key in the browser bundle is exfiltratable and the whole posture collapses. This must be confirmed by ops before merge and re-confirmed at every deployment topology change.

## In Scope

- Delete `bff/` directory and all its dependencies, scripts (`bff:dev`, `build` BFF tsc step), and tests.
- Remove `proxy.conf.json`; `ng serve` no longer proxies `/api/*` anywhere.
- SPA `ApiClient` calls the orchestrator directly via its base URL (build-time env or runtime config).
- **API key delivery — build-time env file.** `ORCHESTRATOR_API_KEY` baked into the bundle via Angular environment files (`src/environments/environment.ts` / `environment.prod.ts`). Key rotation requires a redeploy; that's accepted because rotation is rare and the SPA rebuilds on every deploy anyway.
- **Operator passphrase — kept as a SPA-side UX gate.** Login screen prompts on first load; on success the answer is stored in `sessionStorage`, the route guard checks the flag. Zero real security value (it's gated by the network, not the passphrase), but matches existing operator muscle memory and keeps casual tab-takeover from being a free action. Login no longer calls any backend — it just checks the typed value against an SPA-side configured passphrase.
- Update CORS expectations: the orchestrator must allow the SPA's origin and `withCredentials` if any. Document in `docs/api-spec.md`.
- NDJSON trace stream now goes directly orchestrator → SPA. Confirm no buffering layer in front of the orchestrator collapses chunks.
- Bundle-secret CI gate (`scripts/check-no-secrets-in-bundle.sh`) — **invert** rather than delete. The new check should confirm there's nothing else leaking; the API key is now expected to be present, but for example a passphrase or session secret should not be.
- Lighthouse a11y workflow simplifies — only two services to boot (upstream mock + SPA static server) instead of three.
- Playwright e2e fixtures: SPA points directly at the in-process upstream mock; the BFF chain is gone.

## Out of Scope

- Real per-operator auth (FEAT-004 placeholder, owned by the orchestrator team).
- Multi-orchestrator switching.
- Telemetry or operator activity logging — would need somewhere to live; deferred until the auth story stabilizes.

## Acceptance Criteria

- [ ] `bff/` directory and all BFF-only scripts/dependencies are deleted.
- [ ] `npm run dev` starts only the SPA; no BFF process.
- [ ] An authenticated operator (per the chosen passphrase-or-not decision) can list, open, signal, cancel, and start runs end-to-end against a real orchestrator (or the e2e mock).
- [ ] NDJSON trace renders within 1s on `/runs/:id` against a non-buffering orchestrator response.
- [ ] CORS preflight from the SPA's origin to the orchestrator succeeds for `GET`, `POST`, and the streaming `GET /runs/:id/trace`.
- [ ] The bundle-leak CI scan still runs and explicitly documents which strings are now expected vs. forbidden in the bundle.
- [ ] Lighthouse a11y CI gate stays green at ≥ 0.95 on all four URLs.
- [ ] Playwright e2e tests pass against the new direct-call topology.
- [ ] Documentation reflects reality: `ARCHITECTURE.md`, `api-spec.md`, `ui-specification.md`, `CLAUDE.md`, `stakeholder-definition.md`.

## Entity Impact

None. Wire shapes are unchanged; only the transport pipeline changes.

## API Impact

- The SPA's `ApiClient` swaps its base path from `/api/v1/*` to `${ORCHESTRATOR_BASE_URL}/v1/*`.
- `Authorization: Bearer ${ORCHESTRATOR_API_KEY}` is now attached by the SPA itself rather than by the BFF.
- `docs/api-spec.md` is reframed: it documents the SPA-as-orchestrator-client, not BFF-as-translator. Auth section needs the most surgery.
- Problem-details flows unchanged — orchestrator already returns RFC 7807; SPA already parses it.

## UI Impact

- Login screen — keep, drop, or repurpose depending on the passphrase decision (C/D in In Scope). If kept, it stops calling `/auth/login` and stores a value in `sessionStorage` instead.
- `core/auth.guard.ts` — collapses to either "always allow" or "check sessionStorage flag," depending on the passphrase decision.
- Toast/error surfaces unchanged. Trace stream unchanged from the SPA's perspective once CORS is sorted.

## Documentation Impact (must update in this feat)

- `CLAUDE.md` — drop "BFF" tech-stack line; remove `bff/` directory description; rewrite the BFF section under "Code Style & Conventions"; remove the BFF-side "Patterns to Follow" entries; remove the "Don't ship the API key to the browser" anti-pattern (it's now an explicit accepted tradeoff documented elsewhere).
- `docs/ARCHITECTURE.md` — major revision: Component Roles table loses the BFF row; "Data Flow" diagram redraws as SPA → Orchestrator; Security section gets an explicit "Interim posture" subsection naming the network-gating assumption above.
- `docs/api-spec.md` — Auth section rewritten; endpoint paths still `/v1/*` but base URL is the orchestrator, not the BFF.
- `docs/ui-specification.md` — Auth Guard subsection updated; passphrase screen described per chosen decision.
- `docs/stakeholder-definition.md` — Scope table loses the "BFF" component; add a row noting the deferred orchestrator-auth work.
- `proxy.conf.json` — deleted.
- ADR adoption list — `bff/cookie-session.md` (if adopted) gets retired.
- Changelog rows on every authoritative doc, dated when this lands.

## Risks / Open Questions

- **Trace streaming through any reverse proxy in front of the orchestrator.** Same nginx `X-Accel-Buffering: no` concern that the BFF used to address — now the orchestrator's hosting layer must honor it. Worth a single `curl --no-buffer` test against the deployed orchestrator before locking the plan.
- **Bundle-leak CI gate inversion.** Do not just delete the script — keep it and flip its assertions. The API key is now expected to be in the bundle; the gate must guard against *other* leaks (passphrase value, accidental log strings, future credentials).
- **Local development DX.** With no BFF, `npm run dev` becomes simpler, but operators developing locally need the orchestrator (or the in-process e2e mock) reachable on a fixed URL. Document the recommended local dev recipe in `CLAUDE.md`.
- **Audit trail.** Today the BFF could (didn't, but could) log per-operator activity. After this migration, only the orchestrator sees requests, and from its perspective every operator looks like the same API key. Flag for FEAT-004 (real auth) — operator identity becomes visible upstream only after that.
- **Passphrase storage in `sessionStorage`.** Per-tab; survives reload, dies on tab close. If we wanted "remember me across days" we'd reach for `localStorage`, but that strengthens the false sense of security; `sessionStorage` is the right floor for an interim gate.

## Traceability

- Stakeholder: `docs/stakeholder-definition.md` § "In Scope" — auth/login row needs to be reframed to match the chosen passphrase decision.
- Architecture: `docs/ARCHITECTURE.md` § "Component Roles" + § "Data Flow" + § "Security" all need revision.
- API: `docs/api-spec.md` Auth section + base-URL framing.
- UI: `docs/ui-specification.md` Auth Guard subsection + Login screen if (D) chosen.
- Conventions: `CLAUDE.md` BFF sections.
