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
