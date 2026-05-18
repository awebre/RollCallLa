-- Track where each legislator row + its term dates came from. Surfaces to the UI
-- so users can see at a glance which records are from official chamber rosters
-- and which were pieced together from PDFs / third-party sources like Wikipedia.
--
-- source values:
--   'roster'    - scraped from senate.la.gov / house.louisiana.gov
--   'pdf'       - synthetic row minted from a roll-call PDF (last name only)
--
-- term_source values:
--   'official'   - eventual official source (none populated yet)
--   'wikipedia'  - Wikipedia infobox
--   'derived'    - inferred (e.g. predecessor's term_end set to day before successor's term_start)
ALTER TABLE legislators ADD COLUMN source TEXT;
ALTER TABLE legislators ADD COLUMN term_source TEXT;
CREATE INDEX idx_legislators_source ON legislators(source);

-- Backfill existing rows.
UPDATE legislators SET source = 'roster' WHERE people_id < 900000;
UPDATE legislators SET source = 'pdf'    WHERE people_id BETWEEN 900000 AND 999999;
UPDATE legislators SET term_source = 'wikipedia' WHERE term_start IS NOT NULL AND people_id < 900000;
UPDATE legislators SET term_source = 'derived'   WHERE term_end   IS NOT NULL AND people_id BETWEEN 900000 AND 999999;
