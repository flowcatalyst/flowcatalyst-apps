/**
 * Incremental SSE frame parser (the subset of the spec our server emits:
 * `id:`, `event:`, `data:`, comments, `retry:`). Native `EventSource` can't
 * send an `Authorization` header, so we stream over fetch and parse here.
 */
export interface SseEvent {
  readonly id: string | null;
  readonly event: string;
  readonly data: string;
}

export interface SseParser {
  /** Feed a decoded chunk; returns any events completed by it. */
  feed(chunk: string): SseEvent[];
}

function parseBlock(block: string): SseEvent | null {
  let id: string | null = null;
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue; // comment / heartbeat
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    // Per spec, a single leading space after the colon is stripped.
    const value = line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    // `retry:` is a transport hint; reconnect timing is ours, ignore it.
  }
  if (data.length === 0) return null;
  return { id, event, data: data.join('\n') };
}

export function createSseParser(): SseParser {
  let buffer = '';

  return {
    feed(chunk: string): SseEvent[] {
      buffer += chunk.replace(/\r\n/g, '\n');
      const events: SseEvent[] = [];
      for (;;) {
        const sep = buffer.indexOf('\n\n');
        if (sep === -1) break;
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseBlock(block);
        if (parsed) events.push(parsed);
      }
      return events;
    },
  };
}
