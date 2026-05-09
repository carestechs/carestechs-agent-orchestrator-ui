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
    expect(pushChunk(s, '{"kind":"step","re')).toEqual([]);
    expect(pushChunk(s, 'cordId":"r1"}\n')).toEqual(['{"kind":"step","recordId":"r1"}']);
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
      '{"kind":"step","recordId":"r1","runId":"r","stepNumber":1,"occurredAt":"2026-05-09T09:01:00Z","nodeName":"load","state":"started"}';
    const result = parseTraceLine(line);
    expect(result).toMatchObject({ kind: 'step', recordId: 'r1' });
  });

  it('drops malformed JSON with a console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseTraceLine('not-json')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops records with an unknown kind', () => {
    expect(
      parseTraceLine(
        '{"kind":"telemetry","recordId":"r1","runId":"r","stepNumber":1,"occurredAt":"t"}',
      ),
    ).toBeNull();
  });

  it('drops records missing recordId or occurredAt', () => {
    expect(
      parseTraceLine('{"kind":"step","runId":"r","stepNumber":1,"occurredAt":"t"}'),
    ).toBeNull();
    expect(
      parseTraceLine('{"kind":"step","recordId":"r1","runId":"r","stepNumber":1}'),
    ).toBeNull();
  });
});
