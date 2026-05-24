-- Louisiana Legislator Vote Tracker — initial schema

PRAGMA foreign_keys = ON;

CREATE TABLE sessions (
    session_id   INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    year_start   INTEGER NOT NULL,
    year_end     INTEGER NOT NULL,
    special      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE legislators (
    people_id    INTEGER PRIMARY KEY,
    first_name   TEXT NOT NULL,
    middle_name  TEXT,
    last_name    TEXT NOT NULL,
    suffix       TEXT,
    nickname     TEXT,
    party        TEXT,
    role         TEXT,                 -- "Sen" | "Rep"
    district     TEXT,
    active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_legislators_role   ON legislators(role);
CREATE INDEX idx_legislators_party  ON legislators(party);
CREATE INDEX idx_legislators_active ON legislators(active);

CREATE TABLE bills (
    bill_id        INTEGER PRIMARY KEY,
    session_id     INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    bill_number    TEXT NOT NULL,
    title          TEXT,
    description    TEXT,
    status         INTEGER,
    status_date    TEXT,
    state_url      TEXT,
    url            TEXT,
    change_hash    TEXT
);
CREATE INDEX idx_bills_session ON bills(session_id);
CREATE INDEX idx_bills_number  ON bills(bill_number);

CREATE TABLE bill_subjects (
    bill_id   INTEGER NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
    subject   TEXT NOT NULL,
    PRIMARY KEY (bill_id, subject)
);
CREATE INDEX idx_bill_subjects_subject ON bill_subjects(subject);

CREATE TABLE roll_calls (
    roll_call_id   INTEGER PRIMARY KEY,
    bill_id        INTEGER NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
    date           TEXT NOT NULL,           -- ISO yyyy-mm-dd
    chamber        TEXT NOT NULL,           -- "H" | "S"
    description    TEXT,
    vote_category  TEXT NOT NULL,           -- final_passage|concurrence|override|amendment|procedural|other
    yea            INTEGER NOT NULL DEFAULT 0,
    nay            INTEGER NOT NULL DEFAULT 0,
    nv             INTEGER NOT NULL DEFAULT 0,
    absent         INTEGER NOT NULL DEFAULT 0,
    total          INTEGER NOT NULL DEFAULT 0,
    passed         INTEGER NOT NULL DEFAULT 0,
    margin         INTEGER NOT NULL DEFAULT 0,   -- abs(yea - nay), precomputed for "close votes"
    is_key_vote    INTEGER NOT NULL DEFAULT 0    -- reserved; no admin UI yet
);
CREATE INDEX idx_roll_calls_bill        ON roll_calls(bill_id);
CREATE INDEX idx_roll_calls_category    ON roll_calls(vote_category);
CREATE INDEX idx_roll_calls_chamber     ON roll_calls(chamber);
CREATE INDEX idx_roll_calls_date        ON roll_calls(date);
CREATE INDEX idx_roll_calls_margin      ON roll_calls(margin);
CREATE INDEX idx_roll_calls_key_vote    ON roll_calls(is_key_vote);

CREATE TABLE votes (
    roll_call_id   INTEGER NOT NULL REFERENCES roll_calls(roll_call_id) ON DELETE CASCADE,
    people_id      INTEGER NOT NULL REFERENCES legislators(people_id)  ON DELETE CASCADE,
    vote           INTEGER NOT NULL,        -- 1=Yea, 2=Nay, 3=NV/Abstain, 4=Absent
    PRIMARY KEY (roll_call_id, people_id)
);
CREATE INDEX idx_votes_people ON votes(people_id);
CREATE INDEX idx_votes_vote   ON votes(vote);

CREATE TABLE ingest_runs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at            TEXT NOT NULL,
    finished_at           TEXT,
    trigger               TEXT NOT NULL,       -- "cron" | "manual"
    status                TEXT NOT NULL,       -- "running" | "success" | "error"
    sessions_processed    INTEGER NOT NULL DEFAULT 0,
    bills_upserted        INTEGER NOT NULL DEFAULT 0,
    roll_calls_upserted   INTEGER NOT NULL DEFAULT 0,
    votes_upserted        INTEGER NOT NULL DEFAULT 0,
    error                 TEXT
);
CREATE INDEX idx_ingest_runs_started ON ingest_runs(started_at);
