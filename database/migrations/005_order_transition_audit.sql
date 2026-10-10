-- Add explicit lifecycle audit fields used by transactional order transitions.
BEGIN;
ALTER TABLE audit_events
  ADD COLUMN previous_state text CHECK (previous_state IS NULL OR previous_state IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'fulfilled')),
  ADD COLUMN next_state text CHECK (next_state IS NULL OR next_state IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'fulfilled')),
  ADD COLUMN reason text CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 1000);
COMMIT;
