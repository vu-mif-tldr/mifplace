-- migrate:no-foreign-keys
-- A negative color id means an unpainted pixel (docs/api.md), so a palette color cannot have one.
-- color_id is already unique (INTEGER PRIMARY KEY), the rebuild adds CHECK (color_id >= 0).
-- events.color_id references palette, hence the marker on the first line.
CREATE TABLE palette_new (
    color_id  INTEGER PRIMARY KEY AUTOINCREMENT CHECK (color_id >= 0),
    text      TEXT NOT NULL CHECK (text GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    UNIQUE(text)
) STRICT;

INSERT INTO palette_new (color_id, text) SELECT color_id, text FROM palette;

DROP TABLE palette;

ALTER TABLE palette_new RENAME TO palette;
