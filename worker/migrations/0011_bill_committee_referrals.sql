-- Bill-committee referrals and committee-level roll calls.
--
-- A bill is referred to one committee per chamber per passage attempt.
-- Referral date + bill + committee form the natural key (recommittal is possible).
--
-- Committee roll calls come from legis.la.gov/legis/CommitteeVote.aspx?moi=N.
-- The moi value is the site's identifier for a committee meeting/vote event.

CREATE TABLE bill_committee_referrals (
    id              INTEGER PRIMARY KEY,
    bill_id         INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    committee_id    INTEGER NOT NULL REFERENCES committees(id),
    referral_date   TEXT    NOT NULL,                        -- 'YYYY-MM-DD'
    discharge_date  TEXT,                                    -- NULL = still in committee
    outcome         TEXT    CHECK(outcome IN (
                        'reported',      -- passed out to floor
                        'failed',        -- voted down in committee
                        'deferred',      -- laid on table / deferred
                        'substituted',   -- replaced by substitute bill
                        'other'
                    )),
    UNIQUE(bill_id, committee_id, referral_date)
);
CREATE INDEX idx_bcr_bill       ON bill_committee_referrals(bill_id);
CREATE INDEX idx_bcr_committee  ON bill_committee_referrals(committee_id);

CREATE TABLE committee_roll_calls (
    id              INTEGER PRIMARY KEY,
    moi             INTEGER NOT NULL UNIQUE,                 -- legis.la.gov moi= param
    committee_id    INTEGER NOT NULL REFERENCES committees(id),
    bill_id         INTEGER REFERENCES bills(id),            -- NULL if moi not tied to a bill
    session_id      INTEGER NOT NULL REFERENCES sessions(id),
    date            TEXT    NOT NULL,                        -- 'YYYY-MM-DD'
    description     TEXT,
    yea             INTEGER NOT NULL DEFAULT 0,
    nay             INTEGER NOT NULL DEFAULT 0,
    abstain         INTEGER NOT NULL DEFAULT 0,
    absent          INTEGER NOT NULL DEFAULT 0,
    passed          INTEGER NOT NULL DEFAULT 0               -- 0/1
);
CREATE INDEX idx_crc_committee  ON committee_roll_calls(committee_id);
CREATE INDEX idx_crc_bill       ON committee_roll_calls(bill_id);
CREATE INDEX idx_crc_session    ON committee_roll_calls(session_id);

CREATE TABLE committee_roll_call_votes (
    roll_call_id    INTEGER NOT NULL REFERENCES committee_roll_calls(id) ON DELETE CASCADE,
    legislator_id   INTEGER NOT NULL REFERENCES legislators(id),
    vote            INTEGER NOT NULL CHECK(vote IN (1, 2, 3, 4)), -- 1=Yea 2=Nay 3=Abstain 4=Absent
    PRIMARY KEY (roll_call_id, legislator_id)
);
CREATE INDEX idx_crcv_legislator ON committee_roll_call_votes(legislator_id);
