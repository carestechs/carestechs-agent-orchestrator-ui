import { describe, it, expect, vi } from 'vitest';
import { createParserState, flush, parseTraceLine, pushChunk } from './ndjson-parser';

describe('pushChunk', () => {
  it('returns a single complete line', () => {
    const s = createParserState();
    expect(pushChunk(s, '{"a":1}\n')).toEqual(['{"a":1}']);
    expect(s.buffer).toBe('');
  });

  it('returns multiple lines from one chunk', () => {
    const s = createParserState();
    expect(pushChunk(s, '{"a":1}\n{"a":2}\n{"a":3}\n')).toEqual([
      '{"a":1}',
      '{"a":2}',
      '{"a":3}',
    ]);
  });

  it('buffers a partial line across chunk boundaries', () => {
    const s = createParserState();
    expect(pushChunk(s, '{"kind":"step","da')).toEqual([]);
    expect(pushChunk(s, 'ta":{"id":"r1"}}\n')).toEqual(['{"kind":"step","data":{"id":"r1"}}']);
  });

  it('handles \\r\\n terminators', () => {
    const s = createParserState();
    expect(pushChunk(s, '{"a":1}\r\n{"a":2}\r\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('drops empty lines silently', () => {
    const s = createParserState();
    expect(pushChunk(s, '{"a":1}\n\n{"a":2}\n')).toEqual(['{"a":1}', '{"a":2}']);
  });
});

describe('flush', () => {
  it('returns the trailing buffer when no terminator was emitted', () => {
    const s = createParserState();
    pushChunk(s, '{"a":1');
    expect(flush(s)).toEqual(['{"a":1']);
    expect(s.buffer).toBe('');
  });

  it('returns [] when the buffer is empty', () => {
    const s = createParserState();
    expect(flush(s)).toEqual([]);
  });
});

describe('parseTraceLine', () => {
  it('decodes a valid step record', () => {
    const line =
      '{"kind":"step","data":{"id":"r1","stepNumber":1,"nodeName":"load_work_item","status":"completed","nodeInputs":{},"nodeResult":{},"error":null,"dispatchedAt":"2026-05-09T09:01:00Z","completedAt":"2026-05-09T09:01:02Z"}}';
    const result = parseTraceLine(line);
    expect(result).toMatchObject({ kind: 'step', data: { id: 'r1', stepNumber: 1 } });
  });

  it('decodes a valid operator_signal record', () => {
    const line =
      '{"kind":"operator_signal","data":{"id":"s1","runId":"r1","name":"implementation-complete","taskId":"T-001","payload":{},"receivedAt":"2026-05-09T09:02:00Z","dedupeKey":"k"}}';
    const result = parseTraceLine(line);
    expect(result).toMatchObject({ kind: 'operator_signal', data: { id: 's1', taskId: 'T-001' } });
  });

  it('drops malformed JSON with a console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseTraceLine('not-json')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops records with an unknown kind', () => {
    expect(
      parseTraceLine('{"kind":"telemetry","data":{"id":"r1"}}'),
    ).toBeNull();
  });

  it('drops records with a missing or non-object data envelope', () => {
    expect(parseTraceLine('{"kind":"step"}')).toBeNull();
    expect(parseTraceLine('{"kind":"step","data":null}')).toBeNull();
    expect(parseTraceLine('{"kind":"step","data":"oops"}')).toBeNull();
  });

  it('drops records missing data.id', () => {
    expect(
      parseTraceLine('{"kind":"step","data":{"stepNumber":1}}'),
    ).toBeNull();
  });
});
