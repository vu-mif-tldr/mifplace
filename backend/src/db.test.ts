import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { MifDb, openDb, resolveDbPath } from "./db.js";
import { loadMigrations, migrate } from "./scripts/migrate.js";

// The real migrations of this project, found without the MIGRATIONS_DIR setting.
const REAL_MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "mifplace-test-"));
}

describe("resolveDbPath", () => {
    it("returns DB_PATH and throws when it is not set", () => {
        const saved = process.env.DB_PATH;
        try {
            process.env.DB_PATH = "/x/y.db";
            assert.equal(resolveDbPath(), "/x/y.db");

            delete process.env.DB_PATH;
            assert.throws(() => resolveDbPath(), /DB_PATH must be set/);

            process.env.DB_PATH = "";
            assert.throws(() => resolveDbPath(), /DB_PATH must be set/);
        } finally {
            if (saved === undefined) delete process.env.DB_PATH;
            else process.env.DB_PATH = saved;
        }
    });
});

describe("openDb", () => {
    it("does not create a missing file or directory", () => {
        const dir = tmpDir();
        const file = path.join(dir, "sub", "t.db");
        assert.throws(() => openDb(file), /Database file not found/);
        assert.equal(fs.existsSync(path.dirname(file)), false);

        fs.mkdirSync(path.dirname(file));
        new Database(file).close();
        openDb(file).close();
        fs.rmSync(dir, { recursive: true });
    });
});

describe("openDb / MifDb", () => {
    it("sets pragmas and stores events", () => {
        const dir = tmpDir();
        const file = path.join(dir, "sub", "t.db");
        fs.mkdirSync(path.dirname(file));
        new Database(file).close();
        const db = openDb(file);
        assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
        assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);
        assert.equal(db.pragma("foreign_keys", { simple: true }), 1);

        migrate(db, loadMigrations(REAL_MIGRATIONS_DIR));
        const mif = new MifDb(db);
        // using a fixed 256*256 position to avoid depending on the canvas size, which is not set in this test
        // at the time of writing, there is no upper limit on the position, only a lower limit of 0, so this is
        // safe as of now
        const id = mif.appendEvent({ user_id: 0, color_id: 7, position: 256*256 }, 1000);
        assert.equal(mif.getLastEventId(), id);

        assert.throws(() => mif.appendEvent({ user_id: -1, color_id: 7, position: 256*256 }, 1000));
        assert.throws(() => mif.appendEvent({ user_id: 0, color_id: -1, position: 256*256 }, 1000));
        assert.throws(() => mif.appendEvent({ user_id: 0, color_id: 7, position: -1 }, 1000));

        mif.close();
        fs.rmSync(dir, { recursive: true });
    });
});
