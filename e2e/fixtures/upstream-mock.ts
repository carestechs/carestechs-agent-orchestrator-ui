// Deterministic in-process orchestrator mock for E2E. Talks the same wire
// shapes as the real orchestrator (camelCase end-to-end per CLAUDE.md) so the
// BFF can forward to it unchanged via ORCHESTRATOR_BASE_URL.
//
// Endpoints implemented:
//   GET  /v1/agents
//   GET  /v1/runs?status=&page=&pageSize=
//   GET  /v1/runs/:id
//   GET  /v1/runs/:id/trace?follow=true
//   POST /v1/runs/:id/signals/dispatch
//   POST /v1/runs/:id/cancel
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

export const SEEDED_RUN_ID = 'run-e2e-001';
export const SEEDED_TASK_ID = 'task-001';
export const SEEDED_AGENT_REF = 'demo-agent@1.0.0';

interface MockState {
  runStatus: 'paused' | 'cancelled' | 'completed';
  signalsByKey: Set<string>;
  openTraceClients: Set<ServerResponse>;
  emittedRecordIds: Set<string>;
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

function runSummary(state: MockState): Record<string, unknown> {
  return {
    id: SEEDED_RUN_ID,
    agentRef: SEEDED_AGENT_REF,
    status: state.runStatus,
    intake: { featureBriefPath: 'docs/work-items/FEAT-001.md' },
    startedAt: '2026-05-09T09:00:00Z',
    endedAt: state.runStatus === 'paused' ? null : nowIso(),
    lastStepNumber: 1,
    terminationReason: state.runStatus === 'cancelled' ? 'cancelled' : null,
  };
}

function runDetail(state: MockState): Record<string, unknown> {
  return {
    ...runSummary(state),
    traceUri: `/v1/runs/${SEEDED_RUN_ID}/trace`,
    budget: { maxSteps: 100 },
    currentNode: 'await-human',
  };
}

function emit(state: MockState, record: Record<string, unknown>): void {
  const id = record['recordId'] as string;
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
  };
}

export function createUpstreamMock(): UpstreamMockHandle {
  let state: MockState = freshState();
  let server: Server | null = null;
  let resolvedPort = 0;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    // Test-only reset endpoint. Lets each Playwright spec restore the mock to
     // a clean run-paused state without restarting the whole stack.
    if (method === 'POST' && url.pathname === '/__test/reset') {
      for (const client of state.openTraceClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      state = freshState();
      res.writeHead(204);
      res.end();
      return;
    }

    // Strip the orchestrator's bearer just by reading it; we don't validate.
    if (method === 'GET' && url.pathname === '/v1/agents') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope([{ ref: SEEDED_AGENT_REF, description: 'demo agent', nodes: [] }]));
      return;
    }

    if (method === 'GET' && url.pathname === '/v1/runs') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope([runSummary(state)], { page: 1, pageSize: 20, total: 1 }));
      return;
    }

    if (method === 'GET' && url.pathname === `/v1/runs/${SEEDED_RUN_ID}`) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope(runDetail(state)));
      return;
    }

    if (method === 'GET' && url.pathname === `/v1/runs/${SEEDED_RUN_ID}/trace`) {
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
        const seq: Array<[number, Record<string, unknown>]> = [
          [50, { kind: 'step', recordId: 'rec-step-1', runId: SEEDED_RUN_ID, stepNumber: 1, occurredAt: nowIso(), nodeName: 'plan', state: 'started' }],
          [120, { kind: 'policy_call', recordId: 'rec-policy-1', runId: SEEDED_RUN_ID, stepNumber: 1, occurredAt: nowIso(), model: 'mock-llm' }],
          [200, { kind: 'executor_call', recordId: 'rec-exec-dispatch', runId: SEEDED_RUN_ID, stepNumber: 1, occurredAt: nowIso(), state: 'dispatched', mode: 'human', taskId: SEEDED_TASK_ID, intake: { taskId: SEEDED_TASK_ID } }],
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

    if (method === 'POST' && url.pathname === `/v1/runs/${SEEDED_RUN_ID}/signals/dispatch`) {
      const raw = await readBody(req);
      let body: { name?: string; taskId?: string } = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* fall through */ }
      const key = `${body.name ?? ''}|${body.taskId ?? ''}`;
      const alreadyReceived = state.signalsByKey.has(key);
      if (!alreadyReceived) {
        state.signalsByKey.add(key);
        // Push two follow-up records so the SPA observes the run advance.
        setTimeout(() => emit(state, {
          kind: 'executor_call',
          recordId: 'rec-exec-completed',
          runId: SEEDED_RUN_ID,
          stepNumber: 1,
          occurredAt: nowIso(),
          state: 'completed',
          mode: 'human',
          taskId: SEEDED_TASK_ID,
        }), 30);
        setTimeout(() => emit(state, {
          kind: 'step',
          recordId: 'rec-step-1-completed',
          runId: SEEDED_RUN_ID,
          stepNumber: 1,
          occurredAt: nowIso(),
          nodeName: 'plan',
          state: 'completed',
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

    if (method === 'POST' && url.pathname === `/v1/runs/${SEEDED_RUN_ID}/cancel`) {
      if (state.runStatus !== 'paused') {
        problemJson(res, 409, 'run-already-terminal', 'Run already terminal');
        return;
      }
      state.runStatus = 'cancelled';
      setTimeout(() => emit(state, {
        kind: 'step',
        recordId: 'rec-step-1-cancelled',
        runId: SEEDED_RUN_ID,
        stepNumber: 1,
        occurredAt: nowIso(),
        nodeName: 'plan',
        state: 'completed',
      }), 30);
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      res.end(envelope(runSummary(state)));
      return;
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
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    },
    reset(): void {
      // Close any open trace responses, then start fresh.
      for (const client of state.openTraceClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      state = freshState();
    },
    get port() { return resolvedPort; },
    get baseUrl() { return `http://127.0.0.1:${resolvedPort}`; },
  };
}
