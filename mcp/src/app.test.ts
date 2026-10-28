import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { PaletteColor } from '@mifplace/shared';
import { MifDb, type Db, type EventRow } from '../../backend/src/db.js';
import { loadMigrations, migrate } from '../../backend/src/scripts/migrate.js';
import { createApp } from './app.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../backend/migrations/', import.meta.url));
const SERVER = fileURLToPath(new URL('./server.ts', import.meta.url));

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

// A migrated database: 128 x 128 canvas, the 16-color palette, test user 0.
function migratedDb(file = ':memory:'): Db {
  const db = new Database(file);
  migrate(db, loadMigrations(MIGRATIONS_DIR));
  return db;
}

function textOf(result: ToolResult): string {
  const [block] = result.content;
  if (block?.type !== 'text') assert.fail('expected one text block');
  return block.text;
}

describe('createApp', () => {
  const client = new Client({ name: 'test', version: '0.0.0' });

  before(async () => {
    const db = migratedDb();
    const mif = new MifDb(db);
    // (1, 2) is position 2 * 128 + 1 = 257, the next cell down is 257 + 128.
    mif.appendEvent({ user_id: 0, color_id: 3, position: 257 }, 1000);
    mif.appendEvent({ user_id: 0, color_id: 5, position: 257 + 128 }, 2000);
    mif.appendEvent({ user_id: 0, color_id: 7, position: 257 }, 3000);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createApp(db).connect(serverTransport);
    await client.connect(clientTransport);
  });

  after(() => client.close());

  it('lists the schema resource and the tools', async () => {
    const { resources } = await client.listResources();
    assert.deepEqual(
      resources.map((r) => r.uri),
      ['mifplace://schema']
    );
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['canvas_size', 'palette', 'pixel_history']);
  });

  it('returns the schema as SQL', async () => {
    const { contents } = await client.readResource({ uri: 'mifplace://schema' });
    const [schema] = contents;
    assert.ok(schema && 'text' in schema);
    assert.match(schema.text, /CREATE TABLE events/);
  });

  it('returns the canvas size and the palette', async () => {
    const size = JSON.parse(textOf(await client.callTool({ name: 'canvas_size' })));
    assert.deepEqual(size, { width: 128, height: 128 });

    const palette = JSON.parse(
      textOf(await client.callTool({ name: 'palette' }))
    ) as PaletteColor[];
    assert.equal(palette.length, 16);
    assert.deepEqual(
      palette.find((c) => c.id === 0),
      { id: 0, color: '#000000' }
    );
  });

  it('returns the history of one cell, newest first', async () => {
    const all = await client.callTool({ name: 'pixel_history', arguments: { x: 1, y: 2 } });
    const events = JSON.parse(textOf(all)) as EventRow[];
    assert.deepEqual(
      events.map((e) => [e.color_id, e.timestamp]),
      [
        [7, 3000],
        [3, 1000],
      ]
    );

    const last = await client.callTool({
      name: 'pixel_history',
      arguments: { x: 1, y: 2, limit: 1 },
    });
    assert.equal(JSON.parse(textOf(last)).length, 1);
  });

  it('rejects x outside the canvas instead of reading the next row', async () => {
    const result = await client.callTool({ name: 'pixel_history', arguments: { x: 128, y: 2 } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /less than canvas width \(128\)/);
  });

  it('rejects arguments outside the input schema', async () => {
    const result = await client.callTool({ name: 'pixel_history', arguments: { x: 0, y: -1 } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Input validation error.*y:/);
  });
});

describe('server', () => {
  it('serves the database from DB_PATH over stdio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mifplace-mcp-test-'));
    const file = path.join(dir, 't.db');
    migratedDb(file).close();

    // Any output on stdout other than MCP messages would break this connection.
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', SERVER],
        env: { ...process.env, DB_PATH: file } as Record<string, string>,
      })
    );
    try {
      const size = JSON.parse(textOf(await client.callTool({ name: 'canvas_size' })));
      assert.deepEqual(size, { width: 128, height: 128 });
    } finally {
      await client.close();
      fs.rmSync(dir, { recursive: true });
    }
  });
});
