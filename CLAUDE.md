# CLAUDE.md

> This file provides guidance to Claude Code (or any AI assistant) when working with this codebase.

## Pre-Work Checklist

Before generating specs, tasks, mockups, or implementation plans, you MUST follow these steps:

1. **Identify the task type** using the routing table in the "AI-Assisted Development Framework" section below. **If working on a specific task (T-XXX), check its Workflow field** and follow the Workflow Enforcement rules before starting implementation.
2. **Read the required files** listed in the routing table for your task type — read them directly, do not ask the user to paste them.
3. **Read the prompt template** from `.ai-framework/prompts/` — this defines the required sections, structure, and quality criteria for the deliverable.
4. **Derive structure from the prompt template, NOT from existing output files.** Specs, tasks, and plans are *outputs* — they may reflect an older version of the framework. The prompt templates in `.ai-framework/prompts/` are the authoritative source for format and structure.

---

## Project Overview

**Tech Stack:** Angular 17+ (standalone components, signals), TypeScript (strict), Tailwind CSS. The SPA calls the orchestrator directly; deployment is gated by network position (see `docs/ARCHITECTURE.md` § "Interim security posture"). Real per-operator authentication is deferred to FEAT-004.
**Repo Type:** Single Angular SPA. One deployable process.

The UI is a consumer of `carestechs-agent-orchestrator`. The orchestrator is headless; this app gives an operator visibility into runs and a button to deliver the human-pause signal. See `docs/stakeholder-definition.md` for scope.

---

## Quick Reference

### Local environment setup

Before `npm run dev` for the first time on a fresh clone:

1. `cp src/environments/environment.example.ts src/environments/environment.ts`
2. Edit `environment.ts` and set:
   - `orchestratorBaseUrl` — local orchestrator URL (or `http://127.0.0.1:4100` for the in-process e2e mock).
   - `orchestratorApiKey` — your dev API key.
   - `operatorPassphrase` — any string; this gates the SPA login screen.
3. For production builds, also create `src/environments/environment.prod.ts` with the same shape and prod values.

Both `environment.ts` and `environment.prod.ts` are gitignored. Never `git add -f` them.

**Security note:** `orchestratorApiKey` is bundled into the browser by design; the orchestrator deployment is gated by network position, not key confidentiality. See `docs/ARCHITECTURE.md` § "Interim security posture".

### Container build & run

After populating `.env` from `.env.example`:

```bash
# If the umbrella's network doesn't exist yet on this host:
docker network create devtools-infra

# Build + run via compose
docker compose -f docker-compose.prod.yml up -d --build

# Verify the stack is actually READY (CORS, bundle URL, authenticated round-trip)
scripts/smoke-prod.sh

# Stop
docker compose -f docker-compose.prod.yml down
```

The container binds **loopback only** on `127.0.0.1:4200`. Reaching it from another LAN host is intentionally impossible — it's part of the network-gated security posture from `docs/ARCHITECTURE.md` § "Interim security posture".

**Build-args caveat.** `ORCHESTRATOR_API_KEY` and `OPERATOR_PASSPHRASE` are passed as `--build-arg` and end up in the image's layer history. Anyone with the image can read them via `docker history`. This is acceptable under the interim posture (the values are in the bundle anyway), but **do not push these images to a shared registry without a separate threat-model review**. Upgrade path: BuildKit `--secret` mounts; out of scope until it matters.

**Re-verify orchestrator CORS** after any orchestrator deployment topology change: `scripts/check-orchestrator-cors.sh`. Without correct CORS posture the SPA cannot reach the orchestrator at all.

### Common Commands

```bash
# Install
npm install

# Development — single process, ng serve only
npm run dev           # ng serve on :4200

# Build (production)
npm run build         # ng build; postbuild scans for forbidden bundle values

# Test
npm test              # vitest (unit)
npm run e2e           # Playwright (smoke flows)

# Lint / format
npm run lint          # eslint
npm run format        # prettier --write
```

### Key Directories

```
.
├── src/                        # Angular SPA
│   ├── app/
│   │   ├── core/               # Singleton services (HTTP client, auth, config)
│   │   ├── features/           # Feature areas (runs, agents, auth) — one folder per route
│   │   │   ├── runs-list/
│   │   │   ├── run-detail/
│   │   │   ├── run-start/
│   │   │   └── login/
│   │   ├── shared/             # Reusable UI components, directives, pipes
│   │   ├── models/             # TS interfaces matching docs/data-model.md
│   │   └── app.routes.ts       # Standalone-component lazy routes (loadComponent)
│   ├── assets/
│   ├── environments/           # environment.example.ts ships; .ts + .prod.ts are gitignored
│   ├── styles.css              # Tailwind directives + global @apply only
│   └── main.ts
├── e2e/                        # Playwright specs + in-process orchestrator mock
├── scripts/                    # serve-spa.mjs (static + SPA fallback), check-no-secrets-in-bundle.sh, etc.
├── docs/                       # Project documentation (this framework)
└── tailwind.config.js
```

---

## Code Style & Conventions

### TypeScript & Angular

- **Use TypeScript strict mode.** No `any`. Prefer `unknown` plus a narrowing type guard at the boundary.
- **Standalone components only.** Every `@Component`, `@Directive`, and `@Pipe` includes `standalone: true`. Never generate or reference an `NgModule` class. (See ADR `angular/standalone-components.md`.)
- **Lazy routes use `loadComponent`.** Never `loadChildren` pointing to a module.
- **Separate template files.** Every component uses `templateUrl` to a co-located `.html` file. No inline `template` strings. (See ADR `angular/separate-template-file.md`.)
- **Tailwind only — no component CSS.** Set `styles: []` in every `@Component`. No `.css` / `.scss` files for components. `@apply` is allowed only in `src/styles.css` for genuinely reusable base patterns. (See ADR `angular/tailwind-no-css.md`.)
- **Signals for component state.** Use `signal()` for writable state, `computed()` for derived state. RxJS is reserved for `HttpClient`, the trace NDJSON stream, and debounced inputs. Use `toSignal()` to bridge observables into templates. (See ADR `angular/signals-state.md`.)
- **Named exports only.** No default exports — except where Angular's `loadComponent` requires a `default export` from a route file; in that case the file's only purpose is to re-export the component as default.
- **Functional composition over classes** for non-Angular-primitive utilities. Use plain functions in `core/` and `shared/`.

### Operator Gate (SPA-side)

- Login compares the typed value against `environment.operatorPassphrase` and writes `'true'` to `sessionStorage` under the key `ao.operator.unlocked`. The route guard reads the flag synchronously.
- This is **not real authentication**. The orchestrator deployment is gated by network position; the SPA gate just keeps casual tab-takeover from being a free action. Real per-operator auth is FEAT-004.
- The `Authorization: Bearer ${orchestratorApiKey}` header is attached by `ApiClient` and `TraceStreamService` on every request. The key value lives in `environment.*.ts` and ships in the bundle by design.

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files (Angular components) | kebab-case `.component.ts/.html` | `runs-list.component.ts` |
| Files (services) | kebab-case `.service.ts` | `runs.service.ts` |
| Files (utilities) | kebab-case `.ts` | `format-date.ts` |
| Component selectors | kebab-case with `app-` prefix | `app-runs-list` |
| Functions / methods | camelCase | `submitSignal` |
| Types / Interfaces | PascalCase | `RunSummary`, `TraceRecord` |
| Constants | UPPER_SNAKE | `DEFAULT_PAGE_SIZE` |
| Signals | suffix-free, noun | `runs = signal<RunSummary[]>([])` |

---

## Patterns & Anti-Patterns

### Patterns to Follow

- **Wire shapes are camelCase end-to-end.** The orchestrator sends camelCase; keep it camelCase into TS interfaces. No snake↔camel conversion layer.
- **Idempotent retries.** All write endpoints are idempotent; let the user retry freely. Do not dedupe client-side.
- **One service per resource** in `core/` (e.g. `RunsService`, `AgentsService`, `SignalsService`). Components consume services; services own HTTP.
- **Trace consumption via `ReadableStream`.** Use `fetch` (not `HttpClient`) for `/v1/runs/{id}/trace` so we can read the NDJSON stream line-by-line. Wrap the iterator into a signal-friendly source.
- **Boundary types.** Every payload from the orchestrator is parsed into a typed interface defined in `src/app/models/`. Do not pass raw `any` JSON deeper than the service layer.

### Anti-Patterns to Avoid

- **No NgModules.** Anywhere. Ever.
- **No inline templates / no component CSS files.** Tailwind classes in the `.html` only.
- **No `BehaviorSubject` / `ReplaySubject` for component state.** Use signals.
- **`ORCHESTRATOR_API_KEY` ships in the browser by design.** This is acceptable only because the orchestrator deployment is network-gated. If that ever stops being true, this whole posture is broken — see `docs/ARCHITECTURE.md` § "Interim security posture" before assuming otherwise.
- **No WebSockets / SSE for the trace.** It is plain NDJSON over HTTP.

---

## Error Handling

- **RFC 7807 problem-details** come back from the orchestrator with `Content-Type: application/problem+json` and a stable `code`. The SPA parses them into a typed `ProblemDetails` interface and surfaces `code` + `title` to the user.
- **`409` on signal submit** means the run is already terminal. Show a toast, refresh the run, do not retry.
- **`404` on signal submit** means the `taskId` isn't in the run's memory. Show the field-level error and prompt the user to re-pick from the awaiting dispatch.
- **`401` from the orchestrator** (rotated/revoked API key) triggers the auth-expiry channel, which locks the operator gate and redirects to `/login?reason=expired`.
- **Network errors / orchestrator unreachable** → full-page error state with a retry button. Never spin forever.
- Use a single global error toast service for transient failures; per-form inline errors for validation.

---

## Testing Conventions

- **Test location:** Co-located. `runs-list.component.spec.ts` next to `runs-list.component.ts`.
- **Naming:** `*.spec.ts`.
- **Framework:** Vitest (unit); Playwright for E2E smoke flows. E2E uses the in-process orchestrator mock at `e2e/fixtures/upstream-mock.ts`.
- **Priority:** Unit tests for services (HTTP shapes, error mapping, NDJSON parsing). Component tests focus on signal-driven behavior, not Tailwind class assertions. One Playwright smoke per critical flow: list → detail → signal, and start-run.

---

## Git Conventions

- **Branch naming:** `feature/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`.
- **Commit style:** Conventional commits — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- **PR requirements:** CI green (lint + unit + build), 1 review, doc updates included per the maintenance table.

---

## Design System (Modern Minimal)

This UI uses the `modern-minimal` profile from `carestechs-ui-design`. Key tokens:

- **Primary:** `sky-500` (#0EA5E9). Hover bg `sky-100`, pressed `sky-600`. Text on primary: white.
- **Secondary accent:** `violet-500` (#8B5CF6). Use sparingly.
- **Neutrals:** `slate-50` page bg, `slate-200` borders, `slate-700` body, `slate-900` headings.
- **Status:** success `emerald-500`, warning `amber-500`, error `red-500`, info `sky-500`.
- **Fonts:** Poppins (headings), Inter (body). Body line-height 1.6.
- **Cards:** elevated — `shadow-sm` default, `hover:shadow-md hover:-translate-y-0.5 transition-all duration-200` on clickable. No border on elevated cards.
- **Buttons:** `rounded-lg` (softer), not `rounded-md`.
- **Spacing:** card `p-6`, section `gap-8`, page `py-8`.
- **Content width:** reading-focused `max-w-5xl`; dashboards `max-w-7xl`.
- **Layout:** mobile-first responsive; sidebar navigation for desktop.

Full design tokens and component behaviors come from `carestechs-ui-design/profiles/modern-minimal.md` and the DDRs it includes. Treat that profile as authoritative when generating mockups or new screens.

---

## AI-Assisted Development Framework

This project includes a bundled AI framework (`.ai-framework/`) with prompt templates, context assembly guides, and documentation maintenance rules.

**If you are an AI agent (e.g., Claude Code):** Read the files listed in the routing table below directly — do not ask the user to paste them. Read the prompt template for your task type to determine the output format.

### Task Generation Routing

| Task Type | Prompt Template | Files to Read |
|-----------|----------------|---------------|
| New feature | `.ai-framework/prompts/feature-tasks.md` | `docs/work-items/FEAT-*.md`, `docs/stakeholder-definition.md`, `CLAUDE.md`, `docs/data-model.md`, `docs/api-spec.md`, `docs/ui-specification.md` |
| Bug fix | `.ai-framework/prompts/bugfix-tasks.md` | `docs/work-items/BUG-*.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md` |
| Refactoring | `.ai-framework/prompts/refactor-tasks.md` | `docs/work-items/IMP-*.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md` |
| Spec generation | `.ai-framework/prompts/spec-generation.md` | `docs/stakeholder-definition.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md` |
| UI spec generation | `.ai-framework/prompts/ui-spec-generation.md` | `docs/stakeholder-definition.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/api-spec.md` |
| UI mockup | `.ai-framework/prompts/mockup-generation.md` | `docs/ui-specification.md` (target screen + Design System), `CLAUDE.md` |
| ADR compilation | `.ai-framework/prompts/compile-adrs.md` | ADR files (from `carestechs-software-architecture`), `.ai-framework/templates/` |
| DDR compilation | `.ai-framework/prompts/compile-ddrs.md` | DDR files (from `carestechs-ui-design`), `.ai-framework/templates/` |
| Task implementation plan | `.ai-framework/prompts/plan-generation.md` | `CLAUDE.md`, task definition, files listed in task's "Files to Modify/Create" |

### Workflow Enforcement

| Workflow | Required Steps Before Implementation |
|----------|--------------------------------------|
| `standard` | 1. Generate plan via `.ai-framework/prompts/plan-generation.md` → `plans/plan-T-XXX-*.md`. 2. Implement. |
| `mockup-first` | 1. Generate HTML mockup via `.ai-framework/prompts/mockup-generation.md`, get approval. 2. Generate plan. 3. Implement. |
| `investigation-first` | 1. Investigate, document findings. 2. Generate plan. 3. Implement. |

**Default classification when Workflow is missing:** Frontend + new screen → `mockup-first`. Root-cause analysis required → `investigation-first`. Otherwise → `standard`.

### Documentation Maintenance Discipline

| Code Change | Document to Update |
|-------------|-------------------|
| New entity / field on the wire | `docs/data-model.md` |
| New / changed orchestrator endpoint consumed by the SPA | `docs/api-spec.md` |
| New / changed screen or component | `docs/ui-specification.md` |
| New service or module | `docs/ARCHITECTURE.md` |
| New convention | `CLAUDE.md` |
| Scope change | `docs/stakeholder-definition.md` |
| New ADR adopted from `carestechs-software-architecture` | `docs/ARCHITECTURE.md` (Key Decisions) + `CLAUDE.md` (Patterns) |
| New DDR adopted from `carestechs-ui-design` | `docs/ui-specification.md` Design System + `CLAUDE.md` Design System section |

**Changelog rule:** Every update to `data-model.md`, `api-spec.md`, `ARCHITECTURE.md`, or `ui-specification.md` includes a changelog entry at the bottom.

### External Reference Repos

- **`carestechs-software-architecture`** — ADRs the UI must comply with. The `angular/*` ADRs are load-bearing for this repo.
- **`carestechs-ui-design`** — DDRs and the `modern-minimal` profile that governs design tokens and component styling.
- **`carestechs-agent-orchestrator`** — the upstream service. Its `docs/api-spec.md`, `docs/data-model.md`, and `docs/stakeholder-definition.md` are authoritative when contracts diverge from this UI's snapshot.
- **`orchestrator-ui-starter.md`** (in DevTools root) — the curated UI-builder brief; this project's docs were seeded from it.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-10 | FEAT-003 — BFF retired. SPA calls the orchestrator directly with a Bearer header read from `environment.*.ts`. Operator gate is now SPA-side (`sessionStorage`). API key lives in the bundle by design; security relies on network-gated orchestrator deployment. |
| 2026-05-11 | FEAT-005 — Container build & run subsection added. Documents the build-arg contract, the loopback-bind security posture, the `smoke-prod.sh` readiness check, the `check-orchestrator-cors.sh` CORS re-verification step, and the build-args-in-layer-history caveat. |
