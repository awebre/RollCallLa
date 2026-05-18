-- The /api/legislators?q=<substr> endpoint does LIKE matching on the name columns.
-- Active roster is only ~144 rows so this is barely measurable in practice, but the
-- table grows over time as synthetic rows accumulate from PDF parsing, and the index
-- is essentially free.
CREATE INDEX idx_legislators_last_name ON legislators(last_name);
