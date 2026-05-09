# carestechs-agent-orchestrator-ui

Operator console for [`carestechs-agent-orchestrator`](../carestechs-agent-orchestrator). Single-page Angular 17+ application backed by a thin Node.js BFF proxy.

## What it is

The orchestrator is a headless service that drives feature lifecycles. It pauses at exactly one node — `request_implementation` — waiting for a human to confirm an implementation is ready to review. This UI exists to let an operator:

1. See which runs are paused and need attention.
2. Watch a run's live NDJSON trace.
3. Submit the awaited `implementation-complete` signal in three fields and one click.
4. Cancel a run that's clearly off-track.

Anything beyond that is explicitly out of scope for v1 (see `docs/stakeholder-definition.md`).

## Architecture at a glance

```
Browser (Angular SPA)  ──cookie session──▶  BFF Proxy (Node)  ──Bearer API key──▶  Orchestrator
```

- **Angular SPA:** Tailwind, signals-based state, standalone components, NDJSON trace via `fetch` + `ReadableStream`. Never talks to the orchestrator directly.
- **BFF Proxy:** Holds the orchestrator API key, terminates the operator session, proxies every `/api/v1/*` call, and pipes the trace stream through unbuffered.

Why a BFF: the orchestrator uses a single static bearer key with no CORS preset. Shipping that to a browser is unsafe; calling it from a browser is impossible. The BFF solves both.

## Reference inputs

This project was scaffolded from three sources:

| Source | What it contributed |
|--------|---------------------|
| [`orchestrator-ui-starter.md`](../orchestrator-ui-starter.md) | API surface, lifecycle concepts, scope guardrails |
| [`carestechs-software-architecture/adrs/angular/*`](../carestechs-software-architecture/adrs/angular) | Standalone components, separate templates, Tailwind-only, signals-state |
| [`carestechs-ui-design/profiles/modern-minimal.md`](../carestechs-ui-design/profiles/modern-minimal.md) | Visual language, tokens, typography, component behaviors |

## Documentation map

```
.
├── CLAUDE.md                       # Code conventions + AI framework routing
├── README.md                       # This file
├── .ai-framework/                  # Bundled prompt templates and guides
└── docs/
    ├── personas/primary-user.md    # The Lifecycle Operator
    ├── stakeholder-definition.md   # Vision, scope, success criteria
    ├── ARCHITECTURE.md             # System shape and key decisions
    ├── data-model.md               # TypeScript view models
    ├── api-spec.md                 # BFF /auth/* + /api/v1/* surface
    ├── ui-specification.md         # Screens, components, design system
    └── work-items/
        └── FEAT-001-runs-list-and-detail.md
```

## Status

Documentation scaffold complete; no application code yet. Start by generating tasks from `FEAT-001` using `.ai-framework/prompts/feature-tasks.md`.

## Quick links

- Upstream API spec: `../carestechs-agent-orchestrator/docs/api-spec.md` (authoritative)
- Upstream data model: `../carestechs-agent-orchestrator/docs/data-model.md`
- Lifecycle YAML: `../carestechs-agent-orchestrator/agents/lifecycle-agent@0.3.0.yaml`
