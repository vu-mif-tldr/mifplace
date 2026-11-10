-- Addresses of people who want to play, collected on vu.place before launch (double opt-in).
-- token is random and is used in the confirm and the unsubscribe links. A row without
-- confirmed_at is pending. Unsubscribing deletes the row. The table is removed after launch.
CREATE TABLE waitlist (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
    token         TEXT NOT NULL UNIQUE CHECK (length(token) >= 32),
    created_at    INTEGER NOT NULL,
    confirmed_at  INTEGER
) STRICT;
