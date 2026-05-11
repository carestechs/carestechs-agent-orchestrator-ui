import { Injectable, computed, signal } from '@angular/core';
import type { TraceRecord, TraceRecordKind } from '../models';
import { notifyAuthExpired } from './auth-events';
import { environment } from '../../environments/environment';
import { createParserState, flush, parseTraceLine, pushChunk } from './ndjson-parser';
import { getOccurredAt } from './trace-helpers';

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1000;

export type TraceStreamStatus = 'idle' | 'connecting' | 'streaming' | 'closed' | 'error';

export interface OpenOptions {
  kinds?: TraceRecordKind[];
}

@Injectable({ providedIn: 'root' })
export class TraceStreamService {
  private readonly _records = signal<TraceRecord[]>([]);
  readonly records = this._records.asReadonly();

  private readonly _status = signal<TraceStreamStatus>('idle');
  readonly status = this._status.asReadonly();

  readonly latestOccurredAt = computed(() => {
    const list = this._records();
    return list.length > 0 ? getOccurredAt(list[list.length - 1]!) : null;
  });

  private controller: AbortController | null = null;
  private retriesUsed = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRunId: string | null = null;
  private currentKinds: TraceRecordKind[] = [];

  open(runId: string, options: OpenOptions = {}): void {
    if (this.controller) this.close();
    this._records.set([]);
    this._status.set('connecting');
    this.retriesUsed = 0;
    this.currentRunId = runId;
    this.currentKinds = options.kinds ?? [];
    this.controller = new AbortController();
    void this.run();
  }

  close(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.controller?.abort();
    this.controller = null;
    this.currentRunId = null;
    this._status.set('closed');
  }

  private buildUrl(): string {
    const params = new URLSearchParams({ follow: 'true' });
    const since = this.latestOccurredAt();
    if (since) params.set('since', since);
    for (const kind of this.currentKinds) params.append('kind', kind);
    return `${environment.orchestratorBaseUrl}/api/v1/runs/${encodeURIComponent(this.currentRunId ?? '')}/trace?${params.toString()}`;
  }

  private async run(): Promise<void> {
    const controller = this.controller;
    const runId = this.currentRunId;
    if (!controller || !runId) return;

    const url = this.buildUrl();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${environment.orchestratorApiKey}` },
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) return;
      this.scheduleRetry();
      return;
    }

    if (controller.signal.aborted) return;

    if (res.status === 401) {
      this._status.set('error');
      notifyAuthExpired();
      return;
    }
    if (!res.ok || !res.body) {
      this.scheduleRetry();
      return;
    }

    this._status.set('streaming');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const state = createParserState();

    try {
      for (;;) {
        if (controller.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          this._status.set('closed');
          return;
        }
        const { done, value } = await reader.read();
        if (controller.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          this._status.set('closed');
          return;
        }
        if (done) {
          const tail = flush(state);
          if (tail.length > 0) this.appendLines(tail);
          // Clean upstream close: try one reconnect with `since=` to catch any
          // records emitted between our last read and the next event.
          if (this.retriesUsed < MAX_RETRIES && !controller.signal.aborted) {
            this.retriesUsed += 1;
            await this.run();
          } else {
            this._status.set('closed');
          }
          return;
        }
        if (!value) continue;
        const lines = pushChunk(state, decoder.decode(value, { stream: true }));
        if (lines.length > 0) this.appendLines(lines);
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) {
        this._status.set('closed');
        return;
      }
      this.scheduleRetry();
    }
  }

  private appendLines(lines: string[]): void {
    const parsed: TraceRecord[] = [];
    for (const line of lines) {
      const rec = parseTraceLine(line);
      if (rec) parsed.push(rec);
    }
    if (parsed.length === 0) return;
    this._records.update((arr) => arr.concat(parsed));
  }

  private scheduleRetry(): void {
    if (this.retriesUsed >= MAX_RETRIES) {
      this._status.set('error');
      return;
    }
    this.retriesUsed += 1;
    this._status.set('connecting');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, RETRY_DELAY_MS);
  }
}
