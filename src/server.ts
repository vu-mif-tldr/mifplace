import express from 'express';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { CooldownError, PixelService, ValidationError } from './pixelService.js';

const PORT = Number(process.env.PORT ?? 3000);
const WIDTH = Number(process.env.CANVAS_WIDTH ?? 128);
const HEIGHT = Number(process.env.CANVAS_HEIGHT ?? 128);
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS ?? 5 * 60 * 1000);
const DB_PATH = process.env.DB_PATH ?? './mifplace.sqlite';

const app = express();
app.use(express.json());

const db = new DatabaseSync(DB_PATH);
const pixelService = new PixelService(db, {
  width: WIDTH,
  height: HEIGHT,
  cooldownMs: COOLDOWN_MS,
});

const server = createServer(app);
const wsServer = new WebSocketServer({ server, path: '/ws' });

function broadcastPlacement(payload: unknown): void {
  const encoded = JSON.stringify(payload);
  for (const client of wsServer.clients) {
    if (client.readyState === client.OPEN) {
      client.send(encoded);
    }
  }
}

app.get('/api/canvas', (_request, response) => {
  response.json(pixelService.getCanvas());
});

app.get('/api/timelapse', (_request, response) => {
  response.json({ placements: pixelService.getTimelapse() });
});

app.post('/api/pixels', (request, response) => {
  try {
    const { userId, x, y, color } = request.body ?? {};
    const placement = pixelService.placePixel(String(userId ?? ''), Number(x), Number(y), String(color ?? ''));

    broadcastPlacement({ type: 'pixel_placed', placement });

    response.status(201).json({ placement });
  } catch (error) {
    if (error instanceof ValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }

    if (error instanceof CooldownError) {
      response.status(429).json({
        error: error.message,
        retryAfterMs: error.retryAfterMs,
      });
      return;
    }

    response.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`mifplace server running on http://localhost:${PORT}`);
});
