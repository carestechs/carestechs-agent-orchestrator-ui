// @vitest-environment jsdom
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TraceStreamService } from './trace-stream.service';
import * as authEvents from './auth-events';

// jsdom does not expose ReadableStream globally — polyfill from node:stream/web.
if (typeof globalThis.ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ReadableStream = NodeReadableStream;
}

interface ControllableStream {
  response: Response;
  push: (s: string) => void;
  close: () => void;
}

function makeStreamingResponse(status = 200): ControllableStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, {
      status,
      headers: { 'content-type': 'application/x-ndjson' },
    }),
    push: (s) => controller.enqueue(enc.encode(s)),
    close: () => controller.close(),
  };
}

const sampleStep = (id: string, occurredAt: string): string =>
  JSON.stringify({
    kind: 'step',
    data: {
      id,
      stepNumber: 1,
      nodeName: 'load_work_item',
      status: 'completed',
      nodeInputs: {},
      nodeResult: null,
      error: null,
      dispatchedAt: occurredAt,
      completedAt: occurredAt,
    },
  });

const sampleStepWithStatus = (
  id: string,
  status: 'pending' | 'dispatched' | 'in_progress' | 'completed' | 'failed',
  occurredAt: string,
): string =>
  JSON.stringify({
    kind: 'step',
    data: {
      id,
      stepNumber: 1,
      nodeName: 'load_work_item',
      status,
      nodeInputs: {},
      nodeResult: null,
      error: null,
      dispatchedAt: occurredAt,
      completedAt: status === 'completed' || status === 'failed' ? occurredAt : null,
    },
  });

let svc: TraceStreamService;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  TestBed.configureTestingModule({});
  svc = TestBed.inject(TraceStreamService);
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  svc.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TraceStreamService', () => {
  it('appends a record to the signal as soon as a complete line arrives', async () => {
    const s = makeStreamingResponse();
    fetchSpy.mockResolvedValueOnce(s.response);
    svc.open('r1');
    s.push(sampleStep('rec-1', '2026-05-09T09:00:01Z') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(1);
    expect(svc.records()[0]!.data.id).toBe('rec-1');
    s.close();
  });

  it('opens the orchestrator URL with Authorization: Bearer and no credentials: include', async () => {
    const s = makeStreamingResponse();
    fetchSpy.mockResolvedValueOnce(s.response);
    svc.open('r1');
    s.push(sampleStep('rec-1', '2026-05-09T09:00:01Z') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:4100\/api\/v1\/runs\/r1\/trace\?/);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^Bearer /);
    expect((init as RequestInit).credentials).toBeUndefined();
    s.close();
  });

  it('buffers partial lines across chunk boundaries', async () => {
    const s = makeStreamingResponse();
    fetchSpy.mockResolvedValueOnce(s.response);
    svc.open('r1');
    const line = sampleStep('rec-1', '2026-05-09T09:00:01Z');
    s.push(line.slice(0, 30));
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(0);
    s.push(line.slice(30) + '\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(1);
    s.close();
  });

  it('reconnects with since=<latestOccurredAt> after a clean upstream close (once)', async () => {
    const first = makeStreamingResponse();
    const second = makeStreamingResponse();
    fetchSpy.mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    svc.open('r1');
    first.push(sampleStep('rec-1', '2026-05-09T09:00:01Z') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    first.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondUrl = String(fetchSpy.mock.calls[1]![0]);
    expect(secondUrl).toContain('since=' + encodeURIComponent('2026-05-09T09:00:01Z'));
    second.close();
  });

  it('sets status to "error" and notifies authExpired on 401', async () => {
    const notifySpy = vi.spyOn(authEvents, 'notifyAuthExpired');
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
    svc.open('r1');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.status()).toBe('error');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('aborts the upstream fetch and stops emitting records when close() is called', async () => {
    const s = makeStreamingResponse();
    let receivedSignal: AbortSignal | undefined;
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      receivedSignal = init.signal ?? undefined;
      return Promise.resolve(s.response);
    });
    svc.open('r1');
    s.push(sampleStep('rec-1', 't') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(1);
    svc.close();
    expect(receivedSignal?.aborted).toBe(true);
    s.push(sampleStep('rec-2', 't2') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(1);
  });

  it('replaces a step record in place when a later transition for the same id arrives', async () => {
    // Real wire: orchestrator emits one step record per status transition
    // (pending → in_progress → completed), all sharing data.id. Without
    // dedupe, the live view stacked stale rows.
    const s = makeStreamingResponse();
    fetchSpy.mockResolvedValueOnce(s.response);
    svc.open('r1');
    s.push(sampleStepWithStatus('step-a', 'pending', '2026-05-09T09:00:01Z') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(1);
    expect((svc.records()[0]! as { data: { status: string } }).data.status).toBe('pending');

    s.push(sampleStepWithStatus('step-a', 'in_progress', '2026-05-09T09:00:02Z') + '\n');
    s.push(sampleStepWithStatus('step-a', 'completed', '2026-05-09T09:00:03Z') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(1);
    expect((svc.records()[0]! as { data: { status: string } }).data.status).toBe('completed');
    s.close();
  });

  it('keeps non-step kinds discrete (does not dedupe by id)', async () => {
    const s = makeStreamingResponse();
    fetchSpy.mockResolvedValueOnce(s.response);
    svc.open('r1');
    // Two policy_call records — should both appear.
    const policyCall = (id: string, at: string): string =>
      JSON.stringify({
        kind: 'policy_call',
        data: {
          id,
          stepId: 'step-a',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          selectedTool: 'pick_node',
          toolArguments: {},
          availableTools: [],
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 100,
          createdAt: at,
        },
      });
    s.push(policyCall('pc-1', '2026-05-09T09:00:01Z') + '\n');
    s.push(policyCall('pc-2', '2026-05-09T09:00:02Z') + '\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.records().length).toBe(2);
    s.close();
  });

  it('caps reconnect attempts at MAX_RETRIES', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('ECONNREFUSED'))
      .mockRejectedValueOnce(new TypeError('ECONNREFUSED'));
    svc.open('r1');
    // First attempt resolves immediately with rejection; retry waits 1s.
    await new Promise((r) => setTimeout(r, 1200));
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(svc.status()).toBe('error');
  });
});
