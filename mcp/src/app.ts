import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MifDb, type Db } from '../../backend/src/db.js';

// The backend is not a library package, so its data access code is imported by path.
// Every call returns a new instance: serveStdio may call the factory more than once.
export function createApp(db: Db): McpServer {
  const mifDb = new MifDb(db);
  const server = new McpServer({ name: 'mifplace', version: '0.1.0' });

  server.registerResource(
    'schema',
    'mifplace://schema',
    { mimeType: 'text/plain' },
    async (uri) => {
      const rows = db.prepare('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL').all() as {
        sql: string;
      }[];
      return { contents: [{ uri: uri.href, text: rows.map((r) => r.sql).join(';\n\n') }] };
    }
  );

  server.registerTool(
    'canvas_size',
    {
      description: 'Size of the canvas, in pixels',
    },
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(mifDb.getCanvasSize()) }] };
    }
  );

  server.registerTool(
    'palette',
    {
      description:
        'The palette of colors used to color the canvas, in RGB hex format with fixed color ids',
    },
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(mifDb.getPalette()) }] };
    }
  );

  server.registerTool(
    'pixel_history',
    {
      description: 'Events for one cell, newest first',
      inputSchema: z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    },
    async ({ x, y, limit }) => {
      const { width, height } = mifDb.getCanvasSize();
      // position is y * width + x, so x >= width would silently read a cell on the next row
      if (x >= width) {
        return {
          content: [{ type: 'text', text: `x must be less than canvas width (${width})` }],
          isError: true,
        };
      }
      // y >= height is a position past the last cell, it would silently return no events
      if (y >= height) {
        return {
          content: [{ type: 'text', text: `y must be less than canvas height (${height})` }],
          isError: true,
        };
      }
      const rows = db
        .prepare('SELECT * FROM events WHERE position = ? ORDER BY id DESC LIMIT ?')
        .all(y * width + x, limit);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    }
  );

  return server;
}
