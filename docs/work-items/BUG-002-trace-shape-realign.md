# BUG-002 — Trace records don't render: wire shape mismatch

## Status
Open — 2026-05-11.

## Summary
The run-detail timeline renders empty even when the orchestrator is streaming `step` records over `GET /api/v1/runs/{run_id}/trace`. Captured wire from a live run shows the orchestrator emits enveloped records (`{ kind, data: { ... } }`) with kind-specific timestamp fields and no top-level `recordId`, `runId`, or `occurredAt`. The SPA's `ndjson-parser.ts` rejects every line because it expects a flat record with those top-level fields, so the records signal never advances and the timeline shows nothing.

This is the same drift-from-stale-spec pattern as BUG-001. The orchestrator is upstream truth (per `CLAUDE.md`); the SPA was modeled against an early, speculative spec that never matched the real implementation.

## Captured wire vs SPA expectations

```jsonl
{"kind":"step","data":{"id":"019e18fa-8a52-732e-b1b9-f9c5dc6b90e9","stepNumber":1,"nodeName":"load_work_item","status":"completed","nodeInputs":{...},"nodeResult":{...},"error":null,"dispatchedAt":"2026-05-11T21:38:53Z","completedAt":"2026-05-11T21:38:56Z"}}
```

| SPA expects | Upstream sends | Notes |
|---|---|---|
| `recordId` (top level) | `data.id` | UUID for all kinds |
| `occurredAt` (single field) | kind-specific: `dispatchedAt`/`completedAt` (step), `createdAt` (policy_call), `receivedAt`/`processedAt` (webhook_event), `receivedAt` (operator_signal) | No unified field; SPA must pick |
| `runId` (top level) | not present (implicit from URL); `data.runId` on `operator_signal` only | Drop the field; run scope already comes from the URL |
| step `state: 'started' \| 'completed' \| 'failed'` | step `data.status: 'pending' \| 'dispatched' \| 'in_progress' \| 'completed' \| 'failed'` | Different field name and enum |
| five kinds incl. `executor_call`, `effector_call` | four kinds: `step`, `policy_call`, `webhook_event`, `operator_signal` | `executor_call` and `effector_call` exist upstream but in **separate** JSONL streams (`<trace_dir>/executors/…`, `<trace_dir>/effectors/…`); they were never going to appear in the run trace |

Source-of-truth references in the orchestrator:
- Discriminant enum: `service.py` lines ~62-67 (4 kinds in main trace stream).
- Per-kind Pydantic schemas: `schemas.py` lines 83-94 (`StepRecord`), 97-110 (`PolicyCall`), 113-123 (`WebhookEvent`), 284-295 (`OperatorSignal`).
- Serializer: `_serialize_trace_record()` in `service.py` line ~535 — `dto.model_dump(mode="json", by_alias=True)`.

## Scope (PR A — this PR)

Make the timeline render again. Minimum-viable port:

1. Rewrite `src/app/models/trace.ts` to match the wire (4 kinds, enveloped `{ kind, data: {…} }`).
2. Add `src/app/core/trace-helpers.ts` with `getRecordId(r)`, `getOccurredAt(r)`, `getStepNumber(r)` so consumers don't repeat the discriminator logic.
3. Rewrite `src/app/core/ndjson-parser.ts` to validate the envelope (require `kind`, `data` object, `data.id` string).
4. Update `src/app/features/run-detail/group-trace-by-step.ts` to read `stepNumber` from `step` records only; non-step kinds bypass the step grouping.
5. Update `src/app/features/run-detail/run-detail.component.{ts,html}` for the new shape. `executor_call` / `effector_call` cases removed; new `operator_signal` case added.
6. Update `src/app/core/trace-stream.service.ts` so `latestOccurredAt` uses the helper (kind-aware) instead of a top-level field.
7. Update unit tests: `ndjson-parser.spec.ts`, `group-trace-by-step.spec.ts`, `run-detail.component.spec.ts`, `trace-stream.service.spec.ts`. Drop or rewrite `awaiting-signal-panel.component.spec.ts` fixtures (the panel itself is silent until PR B).
8. Update `e2e/fixtures/upstream-mock.ts` step / signal records to emit the enveloped shape so the existing e2e suite passes against the new parser.
9. Update `docs/data-model.md` trace section + add BUG-002 changelog row.

### Awaiting-signal cue — intentionally deferred to PR B

The SPA currently pre-fills the signal form's `taskId` by scanning the trace for an `executor_call` with `mode=human, state=dispatched`. That record doesn't exist in the main trace anymore (and never will — it lives in a separate JSONL stream). After this PR the awaiting-signal panel goes silent.

PR B will re-derive the cue from one of:
- a `step` with `nodeName` matching a known human-pause node (`request_implementation`) in `status: 'dispatched'`, or
- a `webhook_event` with `eventType: node_started` for the same node.

That needs a real paused run to verify against. Out of scope for PR A so the trace renders first.

## Acceptance Criteria

- Pasting the captured wire (above) into `parseTraceLine` returns a typed `StepRecord`, not `null`.
- `npm test` passes.
- `npm run e2e` passes against the updated `upstream-mock.ts`.
- Run-detail timeline renders step records with `nodeName` + `status` and groups them by `stepNumber` descending.
- `awaiting-signal-panel` does not error; it renders its "no awaiting dispatch" empty state on every run trace.
- `docs/data-model.md` § Trace records shows the enveloped shape and the 4 kinds; a BUG-002 changelog row is appended.

## Out of Scope
- Rendering policy / webhook / signal records richly. PR A renders them minimally (a one-line "kind · timestamp" badge); polish is PR B's job alongside the awaiting-signal redesign.
- Showing `executor_call` / `effector_call` from the secondary streams. Those will need new endpoints (or a UI-side fetch of the side files) and are out of scope.
- Backwards compatibility with the old flat shape. We delete it cleanly; the e2e mock and unit tests move forward together.

## Scope (PR B — follow-up)

PR A intentionally stopped at "renders at all". Each row shows only `data.nodeName` + `data.status` for steps and a single-line "kind · field" for non-step records. The envelope already carries everything we need to match the `ui-specification.md` trace mockup; PR B wires it through. PR B also lands the refined awaiting-signal cue noted above, since both touch `run-detail.component.html` and `awaiting-signal-panel.component.ts`.

### Rich trace rendering

Per kind, expose the structured fields the orchestrator already sends:

- **Step** — `dispatchedAt` / `completedAt` (formatted + duration when both present), collapsible `nodeInputs` / `nodeResult` JSON panes, a red `error` block when `error !== null`, status pill keyed off `data.status` (already exists).
- **policy_call** — `provider`, `model`, `selectedTool`, collapsible `toolArguments` and `availableTools`, `inputTokens` / `outputTokens` / `latencyMs` in a compact metrics row, `createdAt`.
- **webhook_event** — `eventType` badge, `source` (`engine` / `github`), `signatureOk` indicator, collapsible `payload`, `receivedAt` / `processedAt`.
- **operator_signal** — `name`, `taskId`, collapsible `payload`, `receivedAt`, `dedupeKey` (monospace, secondary).

Implementation notes:
- Add a `<app-trace-record-card>` shared component with one `@switch` per kind so `run-detail.component.html` stays declarative.
- Reuse `getOccurredAt` from `trace-helpers.ts` for the timestamp shown in the card header; per-kind extra timestamps render inline in the body.
- JSON panes: collapsed by default; click-to-expand; use `<pre class="font-mono text-xs">` with `JSON.stringify(value, null, 2)`. No syntax highlighter dep.
- Step group header (already in PR A) keeps `Step N`; cards nested inside the group continue to render in stream order.

### Awaiting-signal cue refinement

Replace the PR A heuristic (`step.status === 'dispatched'`) with a more accurate cue that needs a real paused run to verify against:

1. Primary signal: a `step` whose `data.nodeName` is in a known human-pause allowlist (start with `['request_implementation']`; document how to extend) AND `data.status` is `dispatched` or `in_progress`.
2. Fallback / enrichment: a `webhook_event` with `eventType === 'node_started'` for the same `nodeName`, used to display the dispatch metadata (timestamp, payload preview) above the form.
3. Treat `data.status === 'in_progress'` the same as `dispatched` (the orchestrator transitions through `in_progress` for human nodes too).
4. `taskId` still comes from `step.data.nodeInputs.taskId`; keep the single / picker modes.

### Acceptance Criteria (PR B)

- Each kind renders the fields listed above; collapsibles default closed.
- A paused run with a `request_implementation` step in `dispatched` shows the form pre-filled exactly as PR A; the same run in `in_progress` also shows the form (regression-test against the PR A heuristic).
- A `webhook_event` matching the dispatched step appears above the form with its payload preview (no form if no matching step).
- `npm test` passes (new component spec for `trace-record-card`; updated `awaiting-signal-panel` spec for the allowlist + `in_progress`).
- `npm run e2e` passes — the e2e mock seeds at least one `policy_call` and one `webhook_event` with non-trivial fields so visual rendering is exercised.
- `docs/ui-specification.md` § Trace timeline updated to reflect the per-kind card; BUG-002 PR B changelog row appended to `data-model.md` and `ui-specification.md`.

### Files (PR B)

- `src/app/features/run-detail/trace-record-card.component.{ts,html}` (new)
- `src/app/features/run-detail/run-detail.component.html` (delegate to the card)
- `src/app/features/run-detail/awaiting-signal-panel.component.ts` (allowlist + `in_progress`; consult `webhook_event`)
- `src/app/features/run-detail/awaiting-signal-panel.component.html` (dispatch preview block)
- Specs: `trace-record-card.component.spec.ts` (new), `awaiting-signal-panel.component.spec.ts` (update)
- `e2e/fixtures/upstream-mock.ts` (richer seeded `policy_call` / `webhook_event`)
- `docs/ui-specification.md`, `docs/data-model.md` (changelog rows)

### Out of Scope (PR B)

- `executor_call` / `effector_call` from the secondary JSONL streams — still need new orchestrator endpoints; deferred.
- Search / filter over the timeline.
- Live diffing of `nodeInputs` vs `nodeResult`. JSON-only for now.

## Files
- `src/app/models/trace.ts` (rewrite)
- `src/app/core/trace-helpers.ts` (new)
- `src/app/core/ndjson-parser.ts` (rewrite validation)
- `src/app/core/trace-stream.service.ts` (latestOccurredAt)
- `src/app/features/run-detail/group-trace-by-step.ts`
- `src/app/features/run-detail/run-detail.component.{ts,html}`
- `src/app/features/run-detail/awaiting-signal-panel.component.ts` (filter goes empty)
- Specs: `ndjson-parser.spec.ts`, `group-trace-by-step.spec.ts`, `run-detail.component.spec.ts`, `trace-stream.service.spec.ts`, `awaiting-signal-panel.component.spec.ts`
- `e2e/fixtures/upstream-mock.ts`
- `docs/data-model.md`
