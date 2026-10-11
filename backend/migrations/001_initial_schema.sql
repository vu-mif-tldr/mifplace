CREATE TABLE users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL
);

INSERT INTO users (id, name) VALUES
    (0, 'Test User (Dev Only)');

-- Palette of colors. The color index is used in the events table.
CREATE TABLE palette (
    color_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    text      TEXT NOT NULL CHECK (text GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    UNIQUE(text)
);

INSERT INTO palette (color_id, text) VALUES
    (0, '#000000'),
    (1, '#FFFFFF'),
    (2, '#FF0000'),
    (3, '#00FF00'),
    (4, '#0000FF'),
    (5, '#FFFF00'),
    (6, '#FF00FF'),
    (7, '#00FFFF');

-- Append-only log. A rollback is a new event, rows are never updated or deleted.
CREATE TABLE events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    color_id  INTEGER NOT NULL REFERENCES palette(color_id),
    position  INTEGER NOT NULL CHECK (position >= 0),
    timestamp INTEGER NOT NULL
);
