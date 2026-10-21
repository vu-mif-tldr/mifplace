import type { IncomingMessage, ServerResponse } from 'node:http';

/** Parses an event id from a query parameter or a header. Missing = 0, invalid = -1 (reset). */
export function parseEventId(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : -1;
}

export function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Reads a small JSON body. Returns `undefined` if it is too large or not JSON. */
export async function readJson(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limitBytes) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}
