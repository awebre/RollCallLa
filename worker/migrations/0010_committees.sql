-- ── committees ───────────────────────────────────────────────────────────────
-- One row per standing/select/joint committee. Populated (and kept current)
-- by scrape-committees.mjs.  slug is a stable kebab-case key derived from the
-- source URL; url is stored so the scraper can re-discover new committees by
-- hitting the two index pages and updating this table automatically.
CREATE TABLE committees (
    id      INTEGER PRIMARY KEY,
    slug    TEXT    NOT NULL,
    name    TEXT    NOT NULL,
    chamber TEXT    NOT NULL CHECK(chamber IN ('H','S','J')),
    url     TEXT    NOT NULL,
    UNIQUE(chamber, slug)
);

-- ── committee_memberships ─────────────────────────────────────────────────────
-- Temporal membership records.  valid_from is the ISO date the scraper first
-- observed the member; valid_to is the date the scraper first observed them
-- gone (NULL = currently active).  This lets committee votes be attributed to
-- whoever was on the committee on the vote date via:
--   valid_from <= vote_date AND (valid_to IS NULL OR valid_to > vote_date)
--
-- legislator_id resolves via (chamber, source_id) at scrape time — committees
-- only list roster legislators, never pdf-only ones.
CREATE TABLE committee_memberships (
    id              INTEGER PRIMARY KEY,
    committee_id    INTEGER NOT NULL REFERENCES committees(id),
    legislator_id   INTEGER NOT NULL REFERENCES legislators(id),
    session_id      INTEGER NOT NULL REFERENCES sessions(id),
    role            TEXT    NOT NULL
                        CHECK(role IN ('chair','vice_chair','member','interim','ex_officio')),
    valid_from      TEXT    NOT NULL,                              -- ISO date first observed
    valid_to        TEXT,                                          -- ISO date departed; NULL = active
    UNIQUE(committee_id, legislator_id, valid_from)
);
CREATE INDEX idx_committee_memberships_legislator ON committee_memberships(legislator_id);
CREATE INDEX idx_committee_memberships_committee  ON committee_memberships(committee_id);
CREATE INDEX idx_committee_memberships_session    ON committee_memberships(session_id);
CREATE INDEX idx_committee_memberships_active     ON committee_memberships(committee_id, valid_to);
