import type { ServerResponse } from 'node:http';
import { parseEventId, sendJson } from '../http-util.ts';
import { EMPTY_BATCH, HEARTBEAT, RESET, type CatchUp, type Hub, type Waiter } from '../hub.ts';

/** GET /api/poll?after=<id>: answers at once, with an empty batch if there is nothing new. */
export function handleShortPoll(res: ServerResponse, url: URL, hub: Hub): void {
  const missed = hub.catchUp(parseEventId(url.searchParams.get('after')));
  sendJson(res, 200, toPayload(missed, EMPTY_BATCH));
}

/** GET /api/lp?after=<id>: answers when there is something new, or with a heartbeat on timeout. */
export function handleLongPoll(res: ServerResponse, url: URL, hub: Hub, timeoutMs: number): void {
  const after = parseEventId(url.searchParams.get('after'));
  const missed = hub.catchUp(after);
  if (missed !== null) {
    sendJson(res, 200, toPayload(missed, EMPTY_BATCH));
    return;
  }

  // Nothing new yet: park the request until the next batch or the timeout. The headers go out
  // now, so that the client knows at once that its request reached the server.
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.flushHeaders();
  const timer = setTimeout(() => {
    hub.unwait(waiter);
    res.end(HEARTBEAT);
  }, timeoutMs);
  const waiter: Waiter = {
    wake() {
      clearTimeout(timer);
      res.end(toPayload(hub.catchUp(after), HEARTBEAT));
    },
    close() {
      clearTimeout(timer);
      res.destroy();
    },
  };
  hub.wait(waiter);
  res.on('close', () => {
    clearTimeout(timer);
    hub.unwait(waiter);
  });
}

function toPayload(missed: CatchUp, whenNothing: string): string {
  if (missed === 'reset') return RESET;
  return missed === null ? whenNothing : missed.payload;
}
