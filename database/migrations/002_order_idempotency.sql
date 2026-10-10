-- Add tenant-scoped idempotency records for order creation.
-- Request keys are client-generated and must not contain secrets or personal data.
BEGIN;

CREATE TABLE order_idempotency_keys (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (organization_id, idempotency_key),
  CHECK (
    (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR
    (response_status BETWEEN 200 AND 299 AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX order_idempotency_created_idx ON order_idempotency_keys (created_at);

COMMIT;
