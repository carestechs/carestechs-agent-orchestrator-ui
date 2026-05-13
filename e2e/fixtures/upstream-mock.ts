// Deterministic in-process orchestrator mock for E2E. Talks the same wire
// shapes as the real orchestrator (camelCase end-to-end per CLAUDE.md) so the
// BFF can forward to it unchanged via ORCHESTRATOR_BASE_URL.
//
// Endpoints implemented:
//   GET  /api/v1/agents
//   GET  /api/v1/runs?status=&page=&pageSize=
//   GET  /api/v1/runs/:id
//   GET  /api/v1/runs/:id/trace?follow=true
//   POST /api/v1/runs/:id/signals
//   POST /api/v1/runs/:id/cancel
//   POST /api/v1/runs                          (start a run; new started runs
//                                          live alongside the seeded one)
//   GET  /api/v1/runs/run-e2e-start-N          (started-run detail)
//   GET  /api/v1/runs/run-e2e-start-N/trace    (started-run NDJSON)
//   POST /__test/reset                     (clear seeded + started state)
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

export const SEEDED_RUN_ID = 'run-e2e-001';
export const SEEDED_TASK_ID = 'task-001';
export const SEEDED_AGENT_REF = 'demo-agent@1.0.0';

interface StartedRun {
  id: string;
  agentRef: string;
  status: 'running';
  intake: Record<string, unknown>;
  startedAt: string;
  // Trace clients listening for this specific run's NDJSON stream.
  traceClients: Set<ServerResponse>;
  // Whether the canned trace sequence has been kicked off for this run.
  traceSeeded: boolean;
}

interface MockState {
  runStatus: 'paused' | 'cancelled' | 'completed';
  signalsByKey: Set<string>;
  openTraceClients: Set<ServerResponse>;
  emittedRecordIds: Set<string>;
  startedRuns: Map<string, StartedRun>;
  startedRunCounter: number;
}

interface UpstreamMockHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  reset(): void;
  readonly port: number;
  readonly baseUrl: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function envelope<T>(data: T, meta: unknown = null): string {
  return JSON.stringify({ data, meta });
}

function problemJson(
  res: ServerResponse,
  status: number,
  code: string,
  title: string,
  detail?: string,
): void {
  res.writeHead(status, { 'content-type': 'application/problem+json; charset=utf-8' });
  res.end(JSON.stringify({ type: 'about:blank', title, status, code, detail }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// Lean list shape: matches the real orchestrator's GET /api/v1/runs response
// (no intake / lastStepNumber). Detail endpoint adds them back.
function runSummary(state: MockState): Record<string, unknown> {
  return {
    id: SEEDED_RUN_ID,
    agentRef: SEEDED_AGENT_REF,
    status: state.runStatus,
    startedAt: '2026-05-09T09:00:00Z',
    endedAt: state.runStatus === 'paused' ? null : nowIso(),
    stopReason: state.runStatus === 'cancelled' ? 'cancelled' : null,
  };
}

function runDetail(state: MockState): Record<string, unknown> {
  return {
    ...runSummary(state),
    intake: { workItem: { id: 'FEAT-001', kind: 'FEAT', content: '# FEAT-001\n\nseeded e2e brief' } },
    lastStepNumber: 1,
    traceUri: `/api/v1/runs/${SEEDED_RUN_ID}/trace`,
    budget: { maxSteps: 100 },
    currentNode: 'await-human',
  };
}

function emit(state: MockState, record: Record<string, unknown>): void {
  const data = record['data'] as { id?: string } | undefined;
  const id = data?.id ?? '';
  if (state.emittedRecordIds.has(id)) return;
  state.emittedRecordIds.add(id);
  const line = JSON.stringify(record) + '\n';
  for (const client of state.openTraceClients) {
    try {
      client.write(line);
    } catch {
      // Client closed; skip.
    }
  }
}

function freshState(): MockState {
  return {
    runStatus: 'paused',
    signalsByKey: new Set<string>(),
    openTraceClients: new Set<ServerResponse>(),
    emittedRecordIds: new Set<string>(),
    startedRuns: new Map<string, StartedRun>(),
    startedRunCounter: 0,
  };
}

function startedRunSummary(run: StartedRun): Record<string, unknown> {
  return {
    id: run.id,
    agentRef: run.agentRef,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: null,
    stopReason: null,
  };
}

function startedRunDetail(run: StartedRun): Record<string, unknown> {
  return {
    ...startedRunSummary(run),
    intake: run.intake,
    lastStepNumber: null,
    traceUri: `/api/v1/runs/${run.id}/trace`,
    budget: { maxSteps: 100 },
    currentNode: 'plan',
  };
}

export function createUpstreamMock(): UpstreamMockHandle {
  let state: MockState = freshState();
  let server: Server | null = null;
  let resolvedPort = 0;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    // After FEAT-003 T-030 the SPA calls this mock directly from localhost:4200.
    // Echo the request Origin (or fall back to a wildcard) so preflights succeed
    // for any same-machine test runner. Production orchestrators must do the
    // equivalent; documented in docs/api-spec.md.
    const origin = (req.headers['origin'] as string | undefined) ?? '*';
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'content-type',
      'Vary': 'Origin',
    };
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Test-only reset endpoint. Lets each Playwright spec restore the mock to
     // a clean run-paused state without restarting the whole stack.
    if (method === 'POST' && url.pathname === '/__test/reset') {
      for (const client of state.openTraceClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      for (const run of state.startedRuns.values()) {
        for (const client of run.traceClients) {
          try { client.end(); } catch { /* ignore */ }
        }
      }
      state = freshState();
      res.writeHead(204);
      res.end();
      return;
    }

    // Strip the orchestrator's bearer just by reading it; we don't validate.
    if (method === 'GET' && url.pathname === '/api/v1/agents') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope([{ ref: SEEDED_AGENT_REF, description: 'demo agent', nodes: [] }]));
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/runs') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope([runSummary(state)], { page: 1, pageSize: 20, totalCount: 1 }));
      return;
    }

    if (method === 'GET' && url.pathname === `/api/v1/runs/${SEEDED_RUN_ID}`) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope(runDetail(state)));
      return;
    }

    if (method === 'GET' && url.pathname === `/api/v1/runs/${SEEDED_RUN_ID}/trace`) {
      res.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
      });
      // flushHeaders so the SPA's TraceStreamService sees the response start
      // immediately; without it, kept-alive small responses can stall.
      res.flushHeaders?.();
      state.openTraceClients.add(res);

      // Replay all already-emitted records first so a reconnecting client picks
      // up where it left off, then schedule the seed sequence on the first
      // open only.
      const seedFresh = state.emittedRecordIds.size === 0;
      const timers: NodeJS.Timeout[] = [];
      if (seedFresh) {
        // BUG-002 PR B: seed values exercise the per-kind card visually and
        // match the awaiting-signal cue's human-pause allowlist
        // (nodeName='request_implementation'). Webhook payload carries the
        // same nodeName so the panel's dispatch-webhook block renders.
        const seq: Array<[number, Record<string, unknown>]> = [
          [50, { kind: 'step', data: { id: 'rec-step-1', stepNumber: 1, nodeName: 'request_implementation', status: 'dispatched', nodeInputs: { taskId: SEEDED_TASK_ID, briefPath: 'docs/work-items/FEAT-001.md' }, nodeResult: null, error: null, dispatchedAt: nowIso(), completedAt: null } }],
          [120, { kind: 'policy_call', data: { id: 'rec-policy-1', stepId: 'rec-step-1', provider: 'anthropic', model: 'claude-sonnet-4-6', selectedTool: 'pick_node', toolArguments: { nodeName: 'request_implementation' }, availableTools: [{ name: 'pick_node' }, { name: 'finish' }], inputTokens: 412, outputTokens: 88, latencyMs: 743, createdAt: nowIso() } }],
          [200, { kind: 'webhook_event', data: { id: 'rec-webhook-1', eventType: 'node_started', engineRunId: 'engine-1', payload: { taskId: SEEDED_TASK_ID, nodeName: 'request_implementation' }, signatureOk: true, source: 'engine', receivedAt: nowIso(), processedAt: nowIso() } }],
        ];
        for (const [delay, record] of seq) {
          const t = setTimeout(() => emit(state, record), delay);
          timers.push(t);
        }
      } else {
        // Replay any prior records to the new client.
        // (We don't store the records themselves — keep this simple; a
        // reconnect mid-stream isn't part of the smoke flow.)
      }

      req.on('close', () => {
        state.openTraceClients.delete(res);
        for (const t of timers) clearTimeout(t);
      });
      return;
    }

    if (method === 'POST' && url.pathname === `/api/v1/runs/${SEEDED_RUN_ID}/signals`) {
      const raw = await readBody(req);
      let body: { name?: string; taskId?: string } = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* fall through */ }
      const key = `${body.name ?? ''}|${body.taskId ?? ''}`;
      const alreadyReceived = state.signalsByKey.has(key);
      if (!alreadyReceived) {
        state.signalsByKey.add(key);
        // Push two follow-up records so the SPA observes the run advance.
        setTimeout(() => emit(state, {
          kind: 'operator_signal',
          data: {
            id: 'rec-signal-1',
            runId: SEEDED_RUN_ID,
            name: body.name ?? 'implementation-complete',
            taskId: body.taskId ?? SEEDED_TASK_ID,
            payload: {},
            receivedAt: nowIso(),
            dedupeKey: key,
          },
        }), 30);
        setTimeout(() => emit(state, {
          kind: 'step',
          data: {
            id: 'rec-step-1-completed',
            stepNumber: 1,
            nodeName: 'plan',
            status: 'completed',
            nodeInputs: {},
            nodeResult: {},
            error: null,
            dispatchedAt: nowIso(),
            completedAt: nowIso(),
          },
        }), 60);
      }
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        data: {
          id: 'sig-001',
          name: body.name ?? 'implementation-complete',
          taskId: body.taskId ?? SEEDED_TASK_ID,
          payload: {},
          receivedAt: nowIso(),
        },
        meta: { alreadyReceived },
      }));
      return;
    }

    if (method === 'POST' && url.pathname === `/api/v1/runs/${SEEDED_RUN_ID}/cancel`) {
      if (state.runStatus !== 'paused') {
        problemJson(res, 409, 'run-already-terminal', 'Run already terminal');
        return;
      }
      state.runStatus = 'cancelled';
      setTimeout(() => emit(state, {
        kind: 'step',
        data: {
          id: 'rec-step-1-cancelled',
          stepNumber: 1,
          nodeName: 'plan',
          status: 'failed',
          nodeInputs: {},
          nodeResult: null,
          error: { reason: 'cancelled' },
          dispatchedAt: nowIso(),
          completedAt: nowIso(),
        },
      }), 30);
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope(runSummary(state)));
      return;
    }

    // POST /api/v1/runs — start-run flow. Generates a deterministic id, persists
    // a StartedRun, and seeds a small canned trace so the SPA's detail screen
    // observes ≥1 record within ~50ms of opening the stream.
    if (method === 'POST' && url.pathname === '/api/v1/runs') {
      const raw = await readBody(req);
      let body: { agentRef?: string; intake?: Record<string, unknown>; budget?: { maxSteps?: number } } = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* fall through */ }
      if (!body.agentRef || typeof body.agentRef !== 'string') {
        problemJson(res, 400, 'invalid-intake', 'agentRef is required');
        return;
      }
      state.startedRunCounter += 1;
      const id = `run-e2e-start-${state.startedRunCounter}`;
      const run: StartedRun = {
        id,
        agentRef: body.agentRef,
        status: 'running',
        intake: body.intake ?? {},
        startedAt: nowIso(),
        traceClients: new Set<ServerResponse>(),
        traceSeeded: false,
      };
      state.startedRuns.set(id, run);
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope(startedRunSummary(run)));
      return;
    }

    // Started runs: GET detail.
    {
      const m = url.pathname.match(/^\/api\/v1\/runs\/(run-e2e-start-\d+)$/);
      if (method === 'GET' && m) {
        const run = state.startedRuns.get(m[1]!);
        if (!run) {
          problemJson(res, 404, 'run-not-found', 'Run not found');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(envelope(startedRunDetail(run)));
        return;
      }
    }

    // Started runs: NDJSON trace.
    {
      const m = url.pathname.match(/^\/api\/v1\/runs\/(run-e2e-start-\d+)\/trace$/);
      if (method === 'GET' && m) {
        const run = state.startedRuns.get(m[1]!);
        if (!run) {
          problemJson(res, 404, 'run-not-found', 'Run not found');
          return;
        }
        res.writeHead(200, {
          'content-type': 'application/x-ndjson',
          'cache-control': 'no-store, no-transform',
          'x-accel-buffering': 'no',
        });
        res.flushHeaders?.();
        run.traceClients.add(res);

        const timers: NodeJS.Timeout[] = [];
        if (!run.traceSeeded) {
          run.traceSeeded = true;
          const seq: Array<[number, Record<string, unknown>]> = [
            [
              30,
              {
                kind: 'step',
                data: {
                  id: `rec-${run.id}-step-1`,
                  stepNumber: 1,
                  nodeName: 'plan',
                  status: 'dispatched',
                  nodeInputs: {},
                  nodeResult: null,
                  error: null,
                  dispatchedAt: nowIso(),
                  completedAt: null,
                },
              },
            ],
          ];
          for (const [delay, record] of seq) {
            const t = setTimeout(() => {
              const line = JSON.stringify(record) + '\n';
              for (const c of run.traceClients) {
                try { c.write(line); } catch { /* skip */ }
              }
            }, delay);
            timers.push(t);
          }
        }

        req.on('close', () => {
          run.traceClients.delete(res);
          for (const t of timers) clearTimeout(t);
        });
        return;
      }
    }

    res.writeHead(404, { 'content-type': 'application/problem+json; charset=utf-8' });
    res.end(JSON.stringify({ type: 'about:blank', title: 'Not found', status: 404, code: 'not-found' }));
  };

  return {
    async start(): Promise<void> {
      if (server) return;
      const s = createServer((req, res) => {
        void handler(req, res).catch((err: unknown) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/problem+json' });
            res.end(JSON.stringify({
              type: 'about:blank',
              title: 'Mock error',
              status: 500,
              code: 'mock-error',
              detail: String(err),
            }));
          } else {
            try { res.end(); } catch { /* ignore */ }
          }
        });
      });
      await new Promise<void>((resolve) => {
        s.listen(Number(process.env['E2E_UPSTREAM_PORT'] ?? 0), '127.0.0.1', () => {
          const addr = s.address();
          if (addr && typeof addr === 'object') resolvedPort = addr.port;
          resolve();
        });
      });
      server = s;
    },
    async stop(): Promise<void> {
      if (!server) return;
      // Close any open trace responses first so the server can exit.
      for (const client of state.openTraceClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      state.openTraceClients.clear();
      for (const run of state.startedRuns.values()) {
        for (const client of run.traceClients) {
          try { client.end(); } catch { /* ignore */ }
        }
      }
      state.startedRuns.clear();
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    },
    reset(): void {
      // Close any open trace responses, then start fresh.
      for (const client of state.openTraceClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      for (const run of state.startedRuns.values()) {
        for (const client of run.traceClients) {
          try { client.end(); } catch { /* ignore */ }
        }
      }
      state = freshState();
    },
    get port() { return resolvedPort; },
    get baseUrl() { return `http://127.0.0.1:${resolvedPort}`; },
  };
}
