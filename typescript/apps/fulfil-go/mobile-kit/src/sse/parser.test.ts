import { describe, expect, it } from 'vitest';
import { createSseParser } from './parser.js';

describe('createSseParser', () => {
  it('parses a complete frame', () => {
    const parser = createSseParser();
    const events = parser.feed('id: 42\nevent: job.assigned\ndata: {"a":1}\n\n');
    expect(events).toEqual([{ id: '42', event: 'job.assigned', data: '{"a":1}' }]);
  });

  it('reassembles frames split across chunks', () => {
    const parser = createSseParser();
    expect(parser.feed('id: 7\nevent: job.acc')).toEqual([]);
    expect(parser.feed('epted\ndata: {}\n')).toEqual([]);
    expect(parser.feed('\n')).toEqual([{ id: '7', event: 'job.accepted', data: '{}' }]);
  });

  it('ignores heartbeat comments and retry hints', () => {
    const parser = createSseParser();
    expect(parser.feed(': ping\n\nretry: 3000\n\n')).toEqual([]);
  });

  it('parses multiple frames in one chunk and defaults event to message', () => {
    const parser = createSseParser();
    const events = parser.feed('data: one\n\nid: 9\ndata: two\n\n');
    expect(events).toEqual([
      { id: null, event: 'message', data: 'one' },
      { id: '9', event: 'message', data: 'two' },
    ]);
  });

  it('joins multi-line data fields and handles CRLF', () => {
    const parser = createSseParser();
    const events = parser.feed('data: a\r\ndata: b\r\n\r\n');
    expect(events).toEqual([{ id: null, event: 'message', data: 'a\nb' }]);
  });
});
