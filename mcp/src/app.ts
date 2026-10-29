import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { cellError, toPosition } from '@mifplace/shared';
import { MifDb, type Db } from '@mifplace/db';

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
      const size = mifDb.getCanvasSize();
      const error = cellError(size, x, y);
      if (error !== undefined) {
        return { content: [{ type: 'text', text: error }], isError: true };
      }
      const rows = mifDb.getPixelHistory(toPosition(size, x, y), limit);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    }
  );

  return server;
}
