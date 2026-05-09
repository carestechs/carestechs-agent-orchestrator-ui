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

**Tech Stack:** Angular 17+ (standalone components, signals), TypeScript (strict), Tailwind CSS, plus a thin Node.js BFF proxy (Express or Fastify) that holds the orchestrator API key and forwards calls.
**Repo Type:** Single Angular SPA + colocated BFF proxy (single repo, two deployable processes).

The UI is a consumer of `carestechs-agent-orchestrator`. The orchestrator is headless; this app gives an operator visibility into runs and a button to deliver the human-pause signal. See `docs/stakeholder-definition.md` for scope.

---

## Quick Reference

### Common Commands

```bash
# Install
npm install

# Development — runs Angular dev server + BFF proxy concurrently
npm run dev

# Angular SPA only
npm run start         # ng serve on :4200, proxy.conf.json forwards /api → BFF

# BFF proxy only
npm run bff:dev       # nodemon on :4000, proxies /api/v1/* → orchestrator

# Build
npm run build         # ng build (production) + tsc on BFF

# Test
npm test              # vitest (unit) — both SPA and BFF
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
│   ├── styles.css              # Tailwind directives + global @apply only
│   └── main.ts
├── bff/                        # Backend-for-Frontend proxy (Node + Express/Fastify)
│   ├── src/
│   │   ├── routes/             # /api/v1/* forwarders, /auth/* (login/logout)
│   │   ├── upstream/           # Orchestrator client, NDJSON pass-through
│   │   ├── session/            # Cookie session middleware
│   │   └── server.ts
│   └── tsconfig.json
├── docs/                       # Project documentation (this framework)
├── tailwind.config.js
└── proxy.conf.json             # ng serve → BFF dev proxy
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

### BFF (Node)

- ESM, TypeScript strict, Fastify or Express — pick one and stay consistent.
- **Never log the orchestrator API key.** It is read once from env (`ORCHESTRATOR_API_KEY`) and only attached to outgoing `Authorization` headers.
- Session cookies are `httpOnly`, `sameSite=lax`, `secure` in production.

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

- **Wire shapes are camelCase end-to-end.** The orchestrator sends camelCase; keep it camelCase through the BFF and into TS interfaces. No snake↔camel conversion layer.
- **Idempotent retries.** All write endpoints are idempotent; let the user retry freely. Do not dedupe client-side.
- **One service per resource** in `core/` (e.g. `RunsService`, `AgentsService`, `SignalsService`). Components consume services; services own HTTP.
- **Trace consumption via `ReadableStream`.** Use `fetch` (not `HttpClient`) for `/runs/{id}/trace` so we can read the NDJSON stream line-by-line. Wrap the iterator into a signal-friendly source.
- **Boundary types.** Every payload from the BFF is parsed into a typed interface defined in `src/app/models/`. Do not pass raw `any` JSON deeper than the service layer.

### Anti-Patterns to Avoid

- **No NgModules.** Anywhere. Ever.
- **No inline templates / no component CSS files.** Tailwind classes in the `.html` only.
- **No `BehaviorSubject` / `ReplaySubject` for component state.** Use signals.
- **Don't ship the API key to the browser.** It lives in BFF env only.
- **Don't call the orchestrator directly from the browser.** No CORS is configured upstream; the BFF is the only client.
- **No WebSockets / SSE for the trace.** It is plain NDJSON over HTTP.

---

## Error Handling

- **RFC 7807 problem-details** come back from the orchestrator with `Content-Type: application/problem+json` and a stable `code`. The BFF passes them through unchanged. The UI parses them into a typed `ProblemDetails` interface and surfaces `code` + `title` to the user.
- **`409` on signal submit** means the run is already terminal. Show a toast, refresh the run, do not retry.
- **`404` on signal submit** means the `taskId` isn't in the run's memory. Show the field-level error and prompt the user to re-pick from the awaiting dispatch.
- **Network errors / BFF down** → full-page error state with a retry button. Never spin forever.
- Use a single global error toast service for transient failures; per-form inline errors for validation.

---

## Testing Conventions

- **Test location:** Co-located. `runs-list.component.spec.ts` next to `runs-list.component.ts`.
- **Naming:** `*.spec.ts`.
- **Framework:** Vitest (unit) for both SPA and BFF; Playwright for E2E smoke flows.
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
| New / changed BFF or orchestrator endpoint | `docs/api-spec.md` |
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
