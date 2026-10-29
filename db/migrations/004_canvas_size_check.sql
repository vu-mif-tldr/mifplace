-- The canvas size must be positive: 0 or a negative value would make every position invalid.
-- SQLite cannot add a CHECK to an existing table, so the table is recreated with the default size.
-- STRICT rejects text and fractional values, id = 0 allows only one row.
DROP TABLE canvas;

CREATE TABLE canvas (
    id     INTEGER PRIMARY KEY CHECK (id = 0),
    width  INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0)
) STRICT;

INSERT INTO canvas (id, width, height) VALUES
    (0, 128, 128);
