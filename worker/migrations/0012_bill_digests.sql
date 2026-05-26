-- Bill digest storage: abstract text extracted from legis.la.gov digest PDFs.
--
-- Each row tracks one version of a bill digest (Original, Engrossed, etc.).
-- docs_id is the ViewDocument.aspx?d= parameter, which is globally unique on
-- the legis.la.gov site and stable — safe to use as a dedup key.

CREATE TABLE bill_digests (
    id          INTEGER PRIMARY KEY,
    bill_id     INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    docs_id     INTEGER NOT NULL UNIQUE,    -- ViewDocument.aspx?d= param; dedup key
    version     TEXT    NOT NULL,           -- e.g. 'Original', 'Engrossed', 'Reengrossed'
    abstract    TEXT,                       -- extracted abstract section
    full_text   TEXT,                       -- full PDF text (for future search)
    fetched_at  TEXT    NOT NULL            -- ISO timestamp
);
CREATE INDEX idx_bill_digests_bill_id ON bill_digests(bill_id);
