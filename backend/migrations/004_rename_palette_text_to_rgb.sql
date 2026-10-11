-- The column holds "#RRGGBB"; SQLite also updates the CHECK and UNIQUE constraints that use it.
ALTER TABLE palette RENAME COLUMN text TO rgb;
