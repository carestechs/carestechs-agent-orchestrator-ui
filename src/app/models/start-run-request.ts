// Wire shape for `POST /api/v1/runs` per docs/api-spec.md.
// `intake` is unconstrained per agent — the orchestrator validates it.
export interface StartRunRequest {
  agentRef: string;
  intake: Record<string, unknown>;
  budget?: { maxSteps: number };
}
