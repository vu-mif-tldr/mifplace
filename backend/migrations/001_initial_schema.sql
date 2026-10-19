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
    (2, '#7F7F7F'),
    (3, '#C3C3C3'),
    (4, '#880015'),
    (5, '#ED1C24'),
    (6, '#FF7F27'),
    (7, '#FFF200'),
    (8, '#22B14C'),
    (9, '#00A2E8'), 
    (10, '#3F48CC'),
    (11, '#A349A4'),
    (12, '#B97A57'),
    (13, '#FFAEC9'),
    (14, '#FFC90E'),
    (15, '#99D9EA');

-- Append-only log. A rollback is a new event, rows are never updated or deleted.
CREATE TABLE events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    color_id  INTEGER NOT NULL REFERENCES palette(color_id),
    position  INTEGER NOT NULL CHECK (position >= 0),
    timestamp INTEGER NOT NULL
);
