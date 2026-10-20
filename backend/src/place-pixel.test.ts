import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { CanvasState } from './canvas-state.js';
import { DEFAULT_MIGRATIONS_DIR, MifDb, configureDb, loadMigrations, migrate } from '@mifplace/db';
import { InvalidPixelError, parsePixel, placePixel } from './place-pixel.js';

const REAL_MIGRATIONS_DIR = DEFAULT_MIGRATIONS_DIR;

describe('parsePixel', () => {
  const limits = { cellCount: 16, colorIds: new Set([0, 1, 2]) };

  it('accepts a pixel inside the canvas with a known color', () => {
    assert.deepEqual(parsePixel({ position: 15, color_id: 2 }, limits), {
      position: 15,
      color_id: 2,
    });
    assert.deepEqual(parsePixel({ position: 0, color_id: 0, extra: 1 }, limits), {
      position: 0,
      color_id: 0,
    });
  });

  it('rejects everything else', () => {
    const bad: unknown[] = [
      null,
      'x',
      [],
      {},
      { position: 16, color_id: 1 },
      { position: -1, color_id: 1 },
      { position: 1.5, color_id: 1 },
      { position: '1', color_id: 1 },
      { position: NaN, color_id: 1 },
      { position: 1 },
      { position: 1, color_id: 3 },
      { position: 1, color_id: '1' },
    ];
    for (const body of bad) {
      assert.throws(() => parsePixel(body, limits), InvalidPixelError, JSON.stringify(body));
    }
  });
});

describe('placePixel', () => {
  const size = { width: 4, height: 4 };

  it('writes the database first, then the memory', () => {
    const calls: string[] = [];
    const mifDb = {
      appendEvent: () => {
        calls.push('db');
        return 7;
      },
    };
    const canvas = {
      setCell: () => {
        calls.push('memory');
      },
    };
    assert.equal(placePixel(mifDb, canvas, { position: 5, color_id: 1 }, 0), 7);
    assert.deepEqual(calls, ['db', 'memory']);
  });

  it('leaves the memory unchanged when the database fails', () => {
    const canvas = new CanvasState(size, [{ position: 1, color_id: 2 }], 1);
    const before = canvas.body('identity');
    const mifDb = {
      appendEvent: () => {
        throw new Error('disk I/O error');
      },
    };
    assert.throws(() => placePixel(mifDb, canvas, { position: 5, color_id: 1 }, 0), /disk I\/O/);
    assert.deepEqual(canvas.body('identity'), before);
  });

  describe('with a real database', () => {
    function openMigrated(): { mif: MifDb; db: Database.Database; dir: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mifplace-test-'));
      const db = configureDb(new Database(path.join(dir, 't.db')));
      migrate(db, loadMigrations(REAL_MIGRATIONS_DIR));
      return { mif: new MifDb(db), db, dir };
    }

    it('stores the event and the cell', () => {
      const { mif, db, dir } = openMigrated();
      const canvas = new CanvasState(size, [], 0);
      const id = placePixel(mif, canvas, { position: 5, color_id: 4 }, 0, 1000);
      assert.equal(mif.getLastEventId(), id);
      assert.equal(canvas.getCell(5), 4);
      assert.equal(canvas.getLastEventId(), id);
      db.close();
      fs.rmSync(dir, { recursive: true });
    });

    it('keeps the memory clean when the insert violates a constraint or the db is closed', () => {
      const { mif, db, dir } = openMigrated();
      const canvas = new CanvasState(size, [], 0);
      const before = canvas.body('identity');

      // unknown user: foreign key violation inside SQLite
      assert.throws(() => placePixel(mif, canvas, { position: 5, color_id: 4 }, 12345));
      assert.deepEqual(canvas.body('identity'), before);
      assert.equal(mif.getLastEventId(), 0);

      db.close();
      assert.throws(() => placePixel(mif, canvas, { position: 5, color_id: 4 }, 0));
      assert.deepEqual(canvas.body('identity'), before);
      fs.rmSync(dir, { recursive: true });
    });
  });
});
