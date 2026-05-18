-- Add the legis.la.gov ViewDocument.aspx?d=<id> identifier for each roll call.
-- Stored so the PDF fetcher can hit the source by document ID without
-- re-traversing the bill pages.

ALTER TABLE roll_calls ADD COLUMN pdf_doc_id INTEGER;
CREATE INDEX idx_roll_calls_pdf_doc_id ON roll_calls(pdf_doc_id);
