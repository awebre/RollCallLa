-- ─────────────────────────────────────────────────────────────────────────────
-- 0009: Fresh schema. Drops all core data tables and rebuilds with:
--   - Surrogate `id INTEGER PRIMARY KEY` on every table
--   - UNIQUE constraints using source-system natural keys (from legis.la.gov)
--   - No more shell roll_call rows / `date='1970-01-01'` sentinel
--   - `docs_id` stored on bills (for BillDocs.aspx PDF discovery)
--   - `pipeline_stage` + `next_chamber` parsed from LabelCurrentStatus
--   - `legislator_sessions` junction for explicit session membership
--
-- Admin tables (feedback, admin_credentials, admin_challenges, admin_setup_token)
-- are intentionally untouched. They have no FKs into core data.
--
-- Safe to wipe because: feedback table is empty; all other data is re-derivable
-- from legis.la.gov via scrape-bills.mjs + parse-rollcalls.mjs.
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS roll_calls;
DROP TABLE IF EXISTS bill_subjects;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS legislator_sessions;
DROP TABLE IF EXISTS legislators;
DROP TABLE IF EXISTS ingest_runs;
DROP TABLE IF EXISTS sessions;

PRAGMA foreign_keys = ON;

-- ── sessions ──────────────────────────────────────────────────────────────────
-- One row per legislative session as named on legis.la.gov ('24RS', '25RS', '24ES1').
CREATE TABLE sessions (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,                              -- '24RS', '25RS'
    year          INTEGER NOT NULL,
    type          TEXT    NOT NULL CHECK(type IN ('regular','special')),
    start_date    TEXT,
    end_date      TEXT,
    map_vintage   TEXT    NOT NULL DEFAULT '2022',               -- preserves 0006 column
    UNIQUE(name)
);

-- ── legislators ───────────────────────────────────────────────────────────────
-- One row per person across all sessions.
-- source_id  = chamber-roster ID (from senate.la.gov or house.louisiana.gov).
-- NULL source_id = pdf-only legislator (matched from PDF, no roster entry found).
CREATE TABLE legislators (
    id          INTEGER PRIMARY KEY,
    chamber     TEXT    NOT NULL CHECK(chamber IN ('H','S')),
    source_id   INTEGER,                                          -- NULL for pdf-only
    last_name   TEXT    NOT NULL,
    first_name  TEXT,
    suffix      TEXT,                                             -- 'Jr.', 'III', etc.
    nickname    TEXT,                                             -- '"Beau"', etc.
    party       TEXT    CHECK(party IN ('R','D','I')),
    district    INTEGER,
    source      TEXT    NOT NULL DEFAULT 'roster'
                    CHECK(source IN ('roster','pdf')),
    UNIQUE(chamber, source_id)
);
CREATE INDEX idx_legislators_last_name ON legislators(last_name);
CREATE INDEX idx_legislators_party     ON legislators(party);

-- Partial UNIQUE for pdf-only legislators (those without a roster source_id).
-- Without this, NULL source_id values would let duplicate synthetic legislators
-- pile up across parse-rollcalls runs — SQLite treats NULL ≠ NULL in UNIQUE.
-- For pdf-only legislators we dedup by (chamber, last_name) instead.
CREATE UNIQUE INDEX idx_legislators_pdf_unique
    ON legislators(chamber, last_name)
    WHERE source = 'pdf';

-- ── legislator_sessions ───────────────────────────────────────────────────────
-- Membership junction. Populated from chamber roster scrapes for the current
-- session, and backfilled from vote records for prior sessions.
-- Per-session fields (role/party/district/term/active) live here, not on
-- legislators, because they change session to session.
CREATE TABLE legislator_sessions (
    id              INTEGER PRIMARY KEY,
    legislator_id   INTEGER NOT NULL REFERENCES legislators(id),
    session_id      INTEGER NOT NULL REFERENCES sessions(id),
    session_name    TEXT    NOT NULL,                             -- denormalized for UNIQUE
    role            TEXT    CHECK(role IN ('Sen','Rep')),
    party           TEXT    CHECK(party IN ('R','D','I')),
    district        INTEGER,
    active          INTEGER NOT NULL DEFAULT 1,
    term_start      TEXT,
    term_end        TEXT,
    year_elected    INTEGER,
    UNIQUE(legislator_id, session_name)
);
CREATE INDEX idx_legislator_sessions_session ON legislator_sessions(session_id);
CREATE INDEX idx_legislator_sessions_role    ON legislator_sessions(role);

-- ── bills ─────────────────────────────────────────────────────────────────────
-- One row per bill per session.
-- docs_id        = legis.la.gov internal ID used to query BillDocs.aspx for PDFs.
-- pipeline_stage = parsed from LabelCurrentStatus, drives "where is this bill now".
-- next_chamber   = where the bill is headed if mid-pipeline (e.g. House passed,
--                  now in Senate → next_chamber='S').
CREATE TABLE bills (
    id                   INTEGER PRIMARY KEY,
    session_id           INTEGER NOT NULL REFERENCES sessions(id),
    session_name         TEXT    NOT NULL,                        -- denormalized for UNIQUE
    bill_number          TEXT    NOT NULL,                        -- 'HB364', no space
    bill_type            TEXT    NOT NULL,                        -- 'HB','SB','HR','SR','HCR','SCR'
    originating_chamber  TEXT    NOT NULL CHECK(originating_chamber IN ('H','S')),
    title                TEXT,
    docs_id              INTEGER,                                 -- legis.la.gov BillDocs ID
    pipeline_stage       TEXT    NOT NULL DEFAULT 'introduced'
                             CHECK(pipeline_stage IN (
                                 'introduced','committee','floor',
                                 'concurrence','governor','enacted','dead','other')),
    next_chamber         TEXT    CHECK(next_chamber IN ('H','S')),
    status_text          TEXT,                                    -- raw LabelCurrentStatus
    last_scraped_at      TEXT,                                    -- ISO timestamp
    UNIQUE(session_name, bill_number)
);
CREATE INDEX idx_bills_session         ON bills(session_id);
CREATE INDEX idx_bills_pipeline_stage  ON bills(pipeline_stage);
CREATE INDEX idx_bills_next_chamber    ON bills(next_chamber);

-- ── bill_subjects ─────────────────────────────────────────────────────────────
CREATE TABLE bill_subjects (
    id        INTEGER PRIMARY KEY,
    bill_id   INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    subject   TEXT    NOT NULL,
    UNIQUE(bill_id, subject)
);
CREATE INDEX idx_bill_subjects_subject ON bill_subjects(subject);

-- ── roll_calls ────────────────────────────────────────────────────────────────
-- One row per floor vote. Only inserted after the PDF has been parsed —
-- no more shell rows. rc_number is the roll-call number from legis.la.gov,
-- unique within (chamber, session).
CREATE TABLE roll_calls (
    id              INTEGER PRIMARY KEY,
    bill_id         INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    session_id      INTEGER NOT NULL REFERENCES sessions(id),     -- FK for joins
    session_name    TEXT    NOT NULL,                             -- denormalized for UNIQUE
    chamber         TEXT    NOT NULL CHECK(chamber IN ('H','S')),
    rc_number       INTEGER NOT NULL,                             -- from legis.la.gov
    date            TEXT    NOT NULL,                             -- 'YYYY-MM-DD' from PDF
    description     TEXT,
    vote_category   TEXT    NOT NULL DEFAULT 'other'
                        CHECK(vote_category IN (
                            'final_passage','concurrence','override',
                            'amendment','procedural','other')),
    yea             INTEGER NOT NULL DEFAULT 0,
    nay             INTEGER NOT NULL DEFAULT 0,
    nv              INTEGER NOT NULL DEFAULT 0,
    absent          INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    passed          INTEGER NOT NULL DEFAULT 0,                   -- 0/1
    margin          INTEGER NOT NULL DEFAULT 0,                   -- abs(yea - nay)
    pdf_doc_id      INTEGER,                                      -- legis.la.gov doc ID (idempotency)
    UNIQUE(chamber, session_name, rc_number)
);
CREATE INDEX idx_roll_calls_bill      ON roll_calls(bill_id);
CREATE INDEX idx_roll_calls_session   ON roll_calls(session_id);
CREATE INDEX idx_roll_calls_chamber   ON roll_calls(chamber);
CREATE INDEX idx_roll_calls_date      ON roll_calls(date);
CREATE INDEX idx_roll_calls_category  ON roll_calls(vote_category);
CREATE INDEX idx_roll_calls_margin    ON roll_calls(margin);

-- ── votes ─────────────────────────────────────────────────────────────────────
-- Individual legislator votes. No external vote ID exists in legis.la.gov;
-- (roll_call, legislator) IS the natural identity.
CREATE TABLE votes (
    id              INTEGER PRIMARY KEY,
    roll_call_id    INTEGER NOT NULL REFERENCES roll_calls(id) ON DELETE CASCADE,
    legislator_id   INTEGER NOT NULL REFERENCES legislators(id),
    vote            INTEGER NOT NULL CHECK(vote IN (1,2,3,4)),    -- 1=Yea 2=Nay 3=NV 4=Absent
    source          TEXT    NOT NULL DEFAULT 'pdf'
                        CHECK(source IN ('pdf','roster')),
    UNIQUE(roll_call_id, legislator_id)
);
CREATE INDEX idx_votes_legislator ON votes(legislator_id);
CREATE INDEX idx_votes_vote       ON votes(vote);

-- ── ingest_runs ───────────────────────────────────────────────────────────────
-- Audit log for nightly pipeline runs.
-- 'full' is the GHA nightly pipeline run; the per-script stages are kept in
-- the enum for manual/ad-hoc invocations of a single scraper step.
CREATE TABLE ingest_runs (
    id              INTEGER PRIMARY KEY,
    started_at      TEXT    NOT NULL,
    finished_at     TEXT,
    session_id      INTEGER NOT NULL REFERENCES sessions(id),
    stage           TEXT    NOT NULL CHECK(stage IN (
                        'full','rosters','term-dates','scrape-bills',
                        'parse-rollcalls','wiki-terms')),
    trigger         TEXT    NOT NULL DEFAULT 'cron'
                        CHECK(trigger IN ('cron','manual')),
    status          TEXT    NOT NULL DEFAULT 'running'
                        CHECK(status IN ('running','success','error')),
    bills_upserted  INTEGER NOT NULL DEFAULT 0,
    rcs_inserted    INTEGER NOT NULL DEFAULT 0,
    votes_inserted  INTEGER NOT NULL DEFAULT 0,
    error           TEXT
);
CREATE INDEX idx_ingest_runs_started ON ingest_runs(started_at);
CREATE INDEX idx_ingest_runs_session ON ingest_runs(session_id);
