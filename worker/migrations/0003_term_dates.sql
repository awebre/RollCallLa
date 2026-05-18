-- Track when each legislator was first elected, plus optional precise term bounds.
-- year_elected is what `legis.la.gov` exposes on each profile page (`YEARELECTEDLabel`).
-- term_start/term_end let special-election joiners narrow attribution mid-session
-- (e.g. Dana Henry, elected 2026, joined mid-26RS).
ALTER TABLE legislators ADD COLUMN year_elected INTEGER;
ALTER TABLE legislators ADD COLUMN term_start TEXT;
ALTER TABLE legislators ADD COLUMN term_end TEXT;
CREATE INDEX idx_legislators_year_elected ON legislators(year_elected);
