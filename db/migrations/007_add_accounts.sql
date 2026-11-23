-- migrate:no-foreign-keys
-- Accounts: people sign in with an email address and a password (docs/api.md, "Accounts").
-- events.user_id references users, hence the marker on the first line.

-- users is rebuilt: name goes away, the account columns come in. Existing rows (user 0 of the
-- seed scripts) become system users: without an email and a password nobody can sign in as them.
-- password_hash is the Argon2id string of backend/src/auth/password.ts, never the password.
-- verified_at is set once the owner of the address opened the link from the email; an account
-- without it cannot sign in and is deleted after a day. banned_at set means blocked (FR-13).
CREATE TABLE users_new (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
    password_hash  TEXT,
    role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at     INTEGER NOT NULL,
    verified_at    INTEGER,
    banned_at      INTEGER,
    ban_reason     TEXT,
    -- An account has both, a system user has neither
    CHECK ((email IS NULL) = (password_hash IS NULL))
) STRICT;

INSERT INTO users_new (id, created_at) SELECT id, 0 FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- One row per signed-in browser. The cookie holds a random token, the table only its SHA-256
-- (hex), so a copy of the database does not let anyone in. A row past expires_at is not a
-- session; deleting a row signs that browser out.
CREATE TABLE sessions (
    token_hash    TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX sessions_user_id ON sessions(user_id);

-- Single-use tokens from the emails: 'verify' confirms the address, 'reset' sets a new
-- password. Stored as SHA-256 (hex) like the sessions, deleted when used.
CREATE TABLE email_tokens (
    token_hash  TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires_at  INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX email_tokens_user_id ON email_tokens(user_id);
