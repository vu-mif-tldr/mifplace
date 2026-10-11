// Creates the SQLite file (if missing), applies settings and runs pending migrations.
// Usage: npm run db:setup:prod (or db:setup:dev). Settings (DB_PATH, MIGRATIONS_DIR)
// come from the environment, then from .env, see .env.example.
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { configureDb, getDbVersion, resolveDbPath } from "../db.js";
import { loadDotEnv } from "../env.js";
import { MigrationError, loadMigrations, migrate, resolveMigrationsDir } from "./migrate.js";

loadDotEnv(".env");
const dbPath = resolveDbPath();

// The only place that creates the database file, the application uses openDb,
// which fails if the file is missing.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = configureDb(new Database(dbPath));

try {
    const applied = migrate(db, loadMigrations(resolveMigrationsDir()));
    const version = getDbVersion(db);
    console.log(`Applied migrations: ${applied.length > 0 ? applied.join(", ") : "None"}`);
    console.log(`Database ready: ${dbPath} (schema version ${version})`);
} catch (e) {
    // Expected failures get a one-line message, anything else keeps its stack trace.
    if (!(e instanceof MigrationError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
} finally {
    db.close();
}
