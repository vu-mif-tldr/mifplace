# Migrations

Files `NNN_name.sql` (`NNN` is a gap-free sequence starting at 001, name is `[a-z0-9_]+`)
are applied in order by `npm run db:setup`. Each file runs in its own transaction.
The applied state is kept in the database version (SQLite's `PRAGMA user_version`, see
`getDbVersion`) and in the `schema_migrations`
table (version, name, checksum).

## Rules

- **Never edit an applied migration.** The checksum is verified on every run and a
  changed file makes `db:setup` fail. Add a new migration instead.
- **No `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT` in the file.** The runner already wraps it
  in a transaction, otherwise SQLite fails with "cannot start a transaction within a transaction".
- **No `VACUUM` and no `PRAGMA journal_mode`.** Both cannot run inside a transaction.
  Do them by hand or in a separate script.
- Two processes may run the migrator at the same time: the version is checked inside
  a write transaction, so a migration is applied only once.

## Rebuilding a table (changing CHECK, dropping a column, ...)

SQLite cannot alter most constraints, the recipe is: create a new table, copy the
rows, drop the old one, rename. With foreign keys on this fails, and
`PRAGMA foreign_keys` does nothing inside a transaction. Put this marker on the
**first line** of the file:

```sql
-- migrate:no-foreign-keys
CREATE TABLE events_new (...);
INSERT INTO events_new SELECT ... FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
```

The runner turns foreign keys off before the transaction, runs `PRAGMA foreign_key_check`
before committing (any violation rolls the migration back) and turns them on again.
Remember to recreate indexes and triggers of the dropped table.

## Where the files are looked up

`MIGRATIONS_DIR` is required, there is no default: the environment variable wins, then
`backend/.env` (see `.env.example`). `db:setup` fails if neither is set. In Docker copy
the `migrations/` directory into the image and set `ENV MIGRATIONS_DIR=/app/migrations`.
A relative value is resolved against the cwd.
