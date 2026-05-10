# Persona: The Lifecycle Operator

> The engineer babysitting orchestrator runs who needs to see what a paused run is waiting on and deliver the signal it needs without leaving the browser.

## Who They Are

The primary user is a software engineer or technical operator working alongside the headless `carestechs-agent-orchestrator`. They watch lifecycle runs progress, intervene at the single human-pause node (`request_implementation`), and cancel runs that are clearly off-track.

- **Role/Title:** Software Engineer / Tech Lead / Lifecycle Operator
- **Key Characteristics:** Comfortable with CLIs and Git; reads JSON happily; values dense, accurate information over decoration; impatient with anything that hides what the system is actually doing.
- **Relationship with Technology:** High. They already use `curl`, `jq`, and the orchestrator CLI. The UI must earn its place against those tools by being faster for the same job, not different.

## Core Problem

- **The Problem:** A lifecycle run pauses at `request_implementation` for a specific task. The operator must (a) figure out which task is waiting, (b) collect the implementation evidence (commit SHA, PR URL, optional diff), and (c) post a signal so the run advances. Today they do this by reading NDJSON traces in a terminal and crafting `curl` calls.
- **Current Workaround:** `curl` against `/v1/runs/{id}/trace` piped through `jq`, then a hand-typed `curl -X POST .../signals` with a JSON body.
- **Why That Fails:** Reading raw NDJSON to find which task is awaiting input is slow and error-prone. Hand-crafting signal payloads invites typos in `taskId`, which return `404` and cost a round trip to debug.
- **Consequences of Inaction:** Runs sit paused longer than necessary. Throughput of the lifecycle drops. Operators avoid using the orchestrator for non-trivial briefs because the babysitting cost is too high.

## Why This Persona First

- **Pain Acuity:** Sharp — they hit the pain on every paused run, multiple times per day.
- **Market Size:** Small but concentrated — every team running the orchestrator has 1–3 of these operators.
- **Willingness to Pay/Adopt:** High; they will install and use the UI on day one if it shaves 60 seconds off a signal cycle.
- **Strategic Fit:** Validates the consumer-repo pattern in `docs/stakeholder-definition.md` of the orchestrator (Scope Lock: UI lives outside the orchestrator).

## Other Segments Considered

| Segment | Why Not First |
|---------|---------------|
| Non-technical product managers wanting a "feature progress dashboard" | They don't read traces or send signals; serving them needs work-item rollups the orchestrator API doesn't yet expose. |
| Auditors / compliance reviewers (forensics) | Forensics views (steps, policy-calls, work-item history) are valuable but secondary; the operator loop unblocks throughput first. |

## AI Task Generation Notes

> These notes help AI assistants generate better tasks for this persona.

- **User Context:** The operator already has the orchestrator running locally or against a shared dev server. They know the API key and how to set it. They want the UI to surface what's happening, not to teach them what the orchestrator is.
- **Peak Pain Moment:** When a run pauses and the operator must identify the awaiting task and post the right signal payload. Tasks that shorten this loop are highest priority.
- **Success Looks Like:** Open the runs list → click a paused run → see what's waiting → fill three fields → submit. Sub-30-second round trip.
- **Anti-Patterns:** Don't hide the trace behind summaries — operators want the raw event stream available. Don't add multi-step wizards to actions that are one POST. Don't introduce a custom design language; reuse the modern-minimal profile tokens directly.
