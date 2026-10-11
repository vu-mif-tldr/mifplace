import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getDbVersion, type Db } from "../db.js";

export interface Migration {
    version: number;
    name: string;
    sql: string;
    // Table rebuild migrations (new table, copy, DROP, RENAME) need foreign keys
    // off, and PRAGMA foreign_keys is a no-op inside a transaction. Such a
    // migration is marked with NO_FK_MARKER on its first line, see migrations/README.md.
    disableForeignKeys?: boolean;
}

export const NO_FK_MARKER = "-- migrate:no-foreign-keys";

// Failure of a particular migration file; the SQLite error is in `cause`.
export class MigrationError extends Error {
    constructor(readonly migration: Migration, message: string, readonly cause?: unknown) {
        super(`Migration ${migrationFile(migration)} failed: ${message}`);
        this.name = "MigrationError";
    }
}

export function migrationFile(m: Migration): string {
    return `${String(m.version).padStart(3, "0")}_${m.name}.sql`;
}

// Migrations live in backend/migrations as NNN_name.sql files, applied in order
// and tracked by the database version (see getDbVersion). Never edit an already released file,
// add a new one instead.
//
// The directory is taken from the MIGRATIONS_DIR env variable (a relative value is
// resolved against the cwd), there is no default. Locally it comes from .env
// (see .env.example), in Docker from ENV.
export function resolveMigrationsDir(): string {
    const fromEnv = process.env.MIGRATIONS_DIR;
    if (fromEnv) return path.resolve(fromEnv);
    throw new Error("resolveMigrationsDir: MIGRATIONS_DIR must be set");
}

const MIGRATION_FILE = /^(\d+)_([a-z0-9_]+)\.sql$/;

export function loadMigrations(dir: string): Migration[] {
    const migrations: Migration[] = [];
    for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith(".sql")) continue;
        const match = MIGRATION_FILE.exec(file);
        if (match === null) {
            throw new Error(`Invalid migration file name: ${file} (expected NNN_name.sql)`);
        }
        const version = Number(match[1]);
        const expected = migrations.length + 1;
        if (version !== expected) {
            throw new Error(`Migration ${file} has version ${version}, expected ${expected}`);
        }
        const sql = fs.readFileSync(path.join(dir, file), "utf8");
        migrations.push({
            version,
            name: match[2],
            sql,
            disableForeignKeys: sql.split(/\r?\n/, 1)[0].trim() === NO_FK_MARKER,
        });
    }
    return migrations;
}

// Hash of the migration text with normalized line endings, so that git autocrlf
// on another machine does not look like an edit.
export function migrationChecksum(m: Migration): string {
    return createHash("sha256").update(m.sql.replace(/\r\n/g, "\n")).digest("hex");
}

export function setDbVersion(db: Db, version: number): void {
    // PRAGMA does not accept bound parameters, so check the value before building the SQL.
    if (!Number.isInteger(version) || version < 0) throw new Error(`Invalid database version: ${version}`);
    db.pragma(`user_version = ${version}`);
}

// Applies pending migrations, each one in its own IMMEDIATE transaction.
// Returns the versions that were applied by this call.
//
// - The version is re-read inside the write transaction, so two processes
//   migrating at once cannot apply the same migration twice.
// - Applied migrations are recorded in schema_migrations with a checksum and
//   verified on every run, an edited released file is an error.
export function migrate(db: Db, migrations: Migration[]): number[] {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version  INTEGER PRIMARY KEY,
            name     TEXT NOT NULL,
            checksum TEXT NOT NULL
        )`);

    console.log(`Database schema version before apply: ${getDbVersion(db)}`);
    console.log(`Total migrations found: ${migrations.length}`);
    const latest = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;

    const verify = db.transaction(() => {
        const current = getDbVersion(db);
        if (current > latest) {
            throw new Error(
                `Database schema version ${current} is newer than the code supports (${latest})`,
            );
        }
        const rows = db.prepare("SELECT version, name, checksum FROM schema_migrations").all() as
            { version: number; name: string; checksum: string }[];
        const recorded = new Map(rows.map(r => [r.version, r]));
        for (const m of migrations.filter(m => m.version <= current)) {
            const row = recorded.get(m.version);
            const checksum = migrationChecksum(m);
            if (row === undefined) {
                // Database created before checksums existed, trust the current file.
                db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(m.version, m.name, checksum);
            } else if (row.checksum !== checksum || row.name !== m.name) {
                throw new Error(
                    `Migration ${migrationFile(m)} was changed after it was applied. ` +
                    `Revert the edit and add a new migration instead`,
                );
            }
        }
    });
    verify.immediate();

    const applied: number[] = [];
    for (const m of migrations) {
        const tx = db.transaction((): boolean => {
            if (getDbVersion(db) >= m.version) return false; // applied by another process
            try {
                console.log(`Applying migration ${migrationFile(m)}...`);
                db.exec(m.sql);
            } catch (e) {
                // SQLite reports only `near "X": syntax error`, so add the file name.
                throw new MigrationError(m, e instanceof Error ? e.message : String(e), e);
            }
            if (m.disableForeignKeys) {
                const violations = db.pragma("foreign_key_check") as unknown[];
                if (violations.length > 0) {
                    throw new MigrationError(m, `${violations.length} foreign key violation(s) left`);
                }
            }
            db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)")
                .run(m.version, m.name, migrationChecksum(m));
            setDbVersion(db, m.version);
            return true;
        });

        if (m.disableForeignKeys) db.pragma("foreign_keys = OFF"); // no-op inside a transaction
        try {
            if (tx.immediate()) applied.push(m.version);
        } finally {
            if (m.disableForeignKeys) db.pragma("foreign_keys = ON");
        }
    }

    return applied;
}
