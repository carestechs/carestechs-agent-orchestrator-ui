import type { TraceRecord, TraceRecordKind } from '../models';

export interface NdjsonParserState {
  buffer: string;
}

export const createParserState = (): NdjsonParserState => ({ buffer: '' });

/** Append a chunk; return the full lines extracted (excluding any trailing partial). */
export function pushChunk(state: NdjsonParserState, chunk: string): string[] {
  state.buffer += chunk;
  const parts = state.buffer.split('\n');
  state.buffer = parts.pop() ?? '';
  return parts.map((p) => (p.endsWith('\r') ? p.slice(0, -1) : p)).filter((p) => p.length > 0);
}

/** Flush any remaining buffered content as a final line (or [] if empty). */
export function flush(state: NdjsonParserState): string[] {
  const remaining = state.buffer;
  state.buffer = '';
  if (remaining.length === 0) return [];
  const trimmed = remaining.endsWith('\r') ? remaining.slice(0, -1) : remaining;
  return trimmed.length > 0 ? [trimmed] : [];
}

const KNOWN_KINDS: ReadonlySet<TraceRecordKind> = new Set([
  'step',
  'executor_call',
  'policy_call',
  'webhook_event',
  'effector_call',
]);

/** Validate + decode one NDJSON line. Drops malformed records with a console.warn. */
export function parseTraceLine(line: string): TraceRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    console.warn('[trace] dropped malformed line', line.slice(0, 200));
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r['kind'] !== 'string' || !KNOWN_KINDS.has(r['kind'] as TraceRecordKind)) return null;
  if (typeof r['recordId'] !== 'string') return null;
  if (typeof r['occurredAt'] !== 'string') return null;
  return parsed as TraceRecord;
}
