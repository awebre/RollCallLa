CREATE TABLE IF NOT EXISTS admin_setup_token (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_hash TEXT NOT NULL
);
