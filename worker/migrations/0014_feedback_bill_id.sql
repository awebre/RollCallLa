ALTER TABLE feedback ADD COLUMN bill_id INTEGER REFERENCES bills(id);
CREATE INDEX IF NOT EXISTS idx_feedback_bill_id ON feedback(bill_id);
