import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { configureDb, getDbVersion } from "../db.js";
import { MigrationError, loadMigrations, migrate, setDbVersion, resolveMigrationsDir, migrationChecksum, type Migration } from "./migrate.js";

// The real migrations of this project. Tests find them by themselves and do not
// depend on the MIGRATIONS_DIR setting.
const REAL_MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "mifplace-test-"));
}

describe("migrate", () => {
    it("applies the real migrations on :memory:", () => {
        const db = new Database(":memory:");
        db.pragma("foreign_keys = ON");
        const migrations = loadMigrations(REAL_MIGRATIONS_DIR);
        assert.deepEqual(migrate(db, migrations), migrations.map(m => m.version));
        assert.equal(getDbVersion(db), migrations.length);
        db.close();
    });

    it("is a no-op on the second run", () => {
        const db = new Database(":memory:");
        const migrations = loadMigrations(REAL_MIGRATIONS_DIR);
        migrate(db, migrations);
        assert.deepEqual(migrate(db, migrations), []);
        db.close();
    });

    it("rolls back a failing migration and keeps the previous version", () => {
        const db = new Database(":memory:");
        const migrations: Migration[] = [
            { version: 1, name: "ok", sql: "CREATE TABLE a (id INTEGER);" },
            { version: 2, name: "bad", sql: "CREATE TABLE b (id INTEGER); INSERT INTO missing VALUES (1);" },
        ];
        assert.throws(() => migrate(db, migrations));
        assert.equal(getDbVersion(db), 1);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations'").all();
        assert.deepEqual(tables, [{ name: "a" }]);
        db.close();
    });

    it("names the failing file in the error", () => {
        const db = new Database(":memory:");
        const bad: Migration = { version: 1, name: "broken", sql: "CREATE TABLE t (id INTEGER,);" };
        assert.throws(
            () => migrate(db, [bad]),
            (e: unknown) =>
                e instanceof MigrationError &&
                /001_broken\.sql failed: .*syntax error/.test(e.message) &&
                e.cause instanceof Error,
        );
        db.close();
    });

    it("applies a script with triggers and strings containing semicolons", () => {
        const db = new Database(":memory:");
        const sql = `CREATE TABLE t (id INTEGER, v TEXT);
            CREATE TABLE log (msg TEXT);
            CREATE TRIGGER t_ins AFTER INSERT ON t BEGIN
                INSERT INTO log VALUES (CASE WHEN new.v = 'a;b' THEN 'x' ELSE 'y' END);
                INSERT INTO log VALUES ('done');
            END;
            INSERT INTO t VALUES (1, 'a;b');`;
        migrate(db, [{ version: 1, name: "trg", sql }]);
        assert.equal((db.prepare("SELECT COUNT(*) AS n FROM log").get() as { n: number }).n, 2);
        db.close();
    });

    it("refuses a database newer than the code", () => {
        const db = new Database(":memory:");
        setDbVersion(db, 5);
        assert.throws(() => migrate(db, []), /newer than the code/);
        db.close();
    });

    it("supports a table rebuild migration and keeps the data", () => {
        const db = new Database(":memory:");
        const migrations: Migration[] = [
            { version: 1, name: "init", sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'x');" },
            {
                version: 2,
                name: "rebuild",
                sql: `CREATE TABLE t_new (id INTEGER PRIMARY KEY, v TEXT NOT NULL DEFAULT '', extra INTEGER NOT NULL DEFAULT 0);
                      INSERT INTO t_new (id, v) SELECT id, v FROM t;
                      DROP TABLE t;
                      ALTER TABLE t_new RENAME TO t;`,
            },
        ];
        migrate(db, migrations);
        assert.deepEqual(db.prepare("SELECT * FROM t").all(), [{ id: 1, v: "x", extra: 0 }]);
        db.close();
    });
});

describe("migrate: safety", () => {
    const base: Migration[] = [
        { version: 1, name: "init", sql: "CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id)); INSERT INTO p VALUES (1); INSERT INTO c VALUES (1, 1);" },
    ];

    it("detects an edited applied migration", () => {
        const db = new Database(":memory:");
        migrate(db, base);
        const edited = [{ ...base[0], sql: base[0].sql + " -- tweak" }];
        assert.throws(() => migrate(db, edited), /was changed after it was applied/);
        db.close();
    });

    it("ignores line ending differences in the checksum", () => {
        const lf = { ...base[0], sql: base[0].sql.replace(/; /g, ";\n") };
        const crlf = { ...base[0], sql: base[0].sql.replace(/; /g, ";\r\n") };
        assert.equal(migrationChecksum(lf), migrationChecksum(crlf));
    });

    it("backfills checksums for a database created before schema_migrations", () => {
        const db = new Database(":memory:");
        db.exec(base[0].sql);
        setDbVersion(db, 1);
        assert.deepEqual(migrate(db, base), []);
        assert.equal((db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n, 1);
        db.close();
    });

    it("rebuilds a referenced table with the no-foreign-keys mode", () => {
        const db = new Database(":memory:");
        db.pragma("foreign_keys = ON");
        const rebuild = `CREATE TABLE p_new (id INTEGER PRIMARY KEY, extra INTEGER NOT NULL DEFAULT 0);
            INSERT INTO p_new (id) SELECT id FROM p;
            DROP TABLE p;
            ALTER TABLE p_new RENAME TO p;`;
        // The same rebuild without the mode fails, this is what the mode is for.
        const plain = new Database(":memory:");
        plain.pragma("foreign_keys = ON");
        assert.throws(() => migrate(plain, [...base, { version: 2, name: "rebuild", sql: rebuild }]), /FOREIGN KEY/);
        plain.close();

        migrate(db, [...base, { version: 2, name: "rebuild", sql: rebuild, disableForeignKeys: true }]);
        assert.deepEqual(db.prepare("SELECT * FROM p").all(), [{ id: 1, extra: 0 }]);
        assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
        db.close();
    });

    it("rolls back a rebuild that leaves foreign key violations", () => {
        const db = new Database(":memory:");
        const bad = { version: 2, name: "bad", sql: "DELETE FROM p;", disableForeignKeys: true };
        migrate(db, base);
        assert.throws(() => migrate(db, [...base, bad]), /foreign key violation/);
        assert.equal(getDbVersion(db), 1);
        assert.equal((db.prepare("SELECT COUNT(*) AS n FROM p").get() as { n: number }).n, 1);
        assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
        db.close();
    });

    it("runs a data migration once with two connections to the same file", () => {
        const dir = tmpDir();
        const file = path.join(dir, "t.db");
        const migrations: Migration[] = [
            { version: 1, name: "init", sql: "CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT);" },
            { version: 2, name: "seed", sql: "INSERT INTO audit (note) VALUES ('seeded');" },
        ];
        const a = configureDb(new Database(file));
        const b = configureDb(new Database(file));
        // b has read nothing yet, a goes first, b must notice inside its transaction.
        migrate(a, migrations);
        assert.deepEqual(migrate(b, migrations), []);
        assert.equal((a.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n, 1);
        a.close();
        b.close();
        fs.rmSync(dir, { recursive: true });
    });
});

describe("resolveMigrationsDir", () => {
    it("returns MIGRATIONS_DIR as an absolute path and throws when it is not set", () => {
        const saved = process.env.MIGRATIONS_DIR;
        try {
            process.env.MIGRATIONS_DIR = "/x/migrations";
            assert.equal(resolveMigrationsDir(), "/x/migrations");

            process.env.MIGRATIONS_DIR = "rel/dir";
            assert.equal(resolveMigrationsDir(), path.resolve("rel/dir"));

            delete process.env.MIGRATIONS_DIR;
            assert.throws(() => resolveMigrationsDir(), /MIGRATIONS_DIR must be set/);

            process.env.MIGRATIONS_DIR = "";
            assert.throws(() => resolveMigrationsDir(), /MIGRATIONS_DIR must be set/);
        } finally {
            if (saved === undefined) delete process.env.MIGRATIONS_DIR;
            else process.env.MIGRATIONS_DIR = saved;
        }
    });
});

describe("loadMigrations", () => {
    it("detects the no-foreign-keys marker on the first line", () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, "001_a.sql"), "-- migrate:no-foreign-keys\r\nSELECT 1;");
        fs.writeFileSync(path.join(dir, "002_b.sql"), "SELECT 1;\n-- migrate:no-foreign-keys");
        const [a, b] = loadMigrations(dir);
        assert.equal(a.disableForeignKeys, true);
        assert.equal(b.disableForeignKeys, false);
        fs.rmSync(dir, { recursive: true });
    });

    it("rejects gaps in numbering and bad names", () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, "001_a.sql"), "");
        fs.writeFileSync(path.join(dir, "003_c.sql"), "");
        assert.throws(() => loadMigrations(dir), /expected 2/);

        fs.rmSync(path.join(dir, "003_c.sql"));
        fs.writeFileSync(path.join(dir, "bad-name.sql"), "");
        assert.throws(() => loadMigrations(dir), /Invalid migration file name/);
        fs.rmSync(dir, { recursive: true });
    });
});
