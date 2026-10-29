import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MifDb, openDb, resolveDbPath } from './db.js';
import { REPO_ROOT } from './env.js';
import { MIGRATIONS_DIR, loadMigrations, migrate } from './migrate.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mifplace-test-'));
}

describe('resolveDbPath', () => {
  it('resolves DB_PATH against the repository root and throws when it is not set', () => {
    const saved = process.env.DB_PATH;
    try {
      process.env.DB_PATH = '/x/y.db';
      assert.equal(resolveDbPath(), path.resolve('/x/y.db'));

      process.env.DB_PATH = './data/y.db';
      assert.equal(resolveDbPath(), path.join(REPO_ROOT, 'data', 'y.db'));

      delete process.env.DB_PATH;
      assert.throws(() => resolveDbPath(), /DB_PATH must be set/);

      process.env.DB_PATH = '';
      assert.throws(() => resolveDbPath(), /DB_PATH must be set/);
    } finally {
      if (saved === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = saved;
    }
  });
});

describe('openDb', () => {
  it('does not create a missing file or directory', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'sub', 't.db');
    assert.throws(() => openDb(file), /Database file not found/);
    assert.equal(fs.existsSync(path.dirname(file)), false);

    fs.mkdirSync(path.dirname(file));
    new Database(file).close();
    openDb(file).close();
    fs.rmSync(dir, { recursive: true });
  });
});

describe('openDb / MifDb', () => {
  it('sets pragmas and stores events', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'sub', 't.db');
    fs.mkdirSync(path.dirname(file));
    new Database(file).close();
    const db = openDb(file);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mif = new MifDb(db);

    assert.deepEqual(mif.getCanvasSize(), { width: 128, height: 128 });
    // using a fixed 256*256 position to avoid depending on the canvas size, which is not set in this test
    // at the time of writing, there is no upper limit on the position, only a lower limit of 0, so this is
    // safe as of now
    const id = mif.appendEvent({ user_id: 0, color_id: 7, position: 256 * 256 }, 1000);
    assert.equal(mif.getLastEventId(), id);

    mif.appendEvent({ user_id: 0, color_id: 7, position: 5 }, 2000);
    mif.appendEvent({ user_id: 0, color_id: 4, position: 10 }, 3000);
    mif.appendEvent({ user_id: 0, color_id: 2, position: 5 }, 4000);

    assert.deepEqual(
      mif.getEventsAfter(id).map((e) => [e.position, e.color_id, e.timestamp]),
      [
        [5, 7, 2000],
        [10, 4, 3000],
        [5, 2, 4000],
      ]
    );

    assert.throws(() => mif.appendEvent({ user_id: -1, color_id: 7, position: 256 * 256 }, 1000));
    assert.throws(() => mif.appendEvent({ user_id: 0, color_id: -1, position: 256 * 256 }, 1000));
    assert.throws(() => mif.appendEvent({ user_id: 0, color_id: 7, position: -1 }, 1000));

    mif.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('returns the palette', () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mifdb = new MifDb(db);

    // The order of the colors is not guaranteed, look them up by id
    const palette = mifdb.getPalette();
    assert.equal(palette.length, 16);
    assert.deepEqual(
      palette.find((c) => c.id === 0),
      { id: 0, color: '#000000' }
    );
    assert.deepEqual(
      palette.find((c) => c.id === 15),
      { id: 15, color: '#99D9EA' }
    );
    assert.deepEqual(
      palette.map(({ id }) => id).sort((a, b) => a - b),
      Array.from({ length: 16 }, (_, i) => i)
    );

    mifdb.close();
  });

  it('keeps only one positive integer canvas size', () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const update = db.prepare('UPDATE canvas SET width = ?, height = ?');

    for (const [width, height] of [
      [0, 128],
      [128, 0],
      [-128, -128],
      [1.5, 128],
      ['abc', 128],
    ]) {
      assert.throws(() => update.run(width, height), `${width}x${height}`);
    }
    assert.throws(() => db.prepare('INSERT INTO canvas (width, height) VALUES (64, 64)').run());

    update.run(256, 64);
    assert.deepEqual(new MifDb(db).getCanvasSize(), { width: 256, height: 64 });
    db.close();
  });

  it('keeps palette color ids unique and non-negative', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const insert = db.prepare('INSERT INTO palette (color_id, text) VALUES (?, ?)');

    assert.throws(() => insert.run(-1, '#123456'), /CHECK constraint failed/);
    assert.throws(() => insert.run(0, '#123456'), /UNIQUE constraint failed/);
    assert.throws(() => insert.run('abc', '#123456'));

    // Without an id the next free one is taken, events can still reference palette
    const id = Number(
      db.prepare("INSERT INTO palette (text) VALUES ('#123456')").run().lastInsertRowid
    );
    assert.equal(id, 16);
    const mif = new MifDb(db);
    mif.appendEvent({ user_id: 0, color_id: id, position: 0 }, 1000);
    assert.throws(() => mif.appendEvent({ user_id: 0, color_id: 99, position: 0 }, 1000));
    mif.close();
  });
});
