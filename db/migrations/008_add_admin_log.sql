-- What administrators did to accounts (FR-13): one row per action, never changed or deleted.
-- details is the reason of a block. The rows refer to users by id, and a deleted account keeps
-- its row in users (emptied), so the log survives it.
CREATE TABLE admin_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id        INTEGER NOT NULL REFERENCES users(id),
    action          TEXT NOT NULL CHECK (action IN ('block', 'unblock', 'end_sessions')),
    target_user_id  INTEGER NOT NULL REFERENCES users(id),
    details         TEXT,
    timestamp       INTEGER NOT NULL
) STRICT;
