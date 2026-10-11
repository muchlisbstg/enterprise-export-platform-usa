-- Dedicated permissions and idempotency storage for identity administration.
-- No administrator permissions are assigned to any user by this migration.
BEGIN;

INSERT INTO authorization_permissions (permission_key, description) VALUES
  ('identity:manage', 'Manage identity and organization membership lifecycle'),
  ('roles:grant', 'Grant approved role templates to organization members'),
  ('roles:revoke', 'Revoke role assignments from organization members')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE identity_admin_idempotency_keys (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (organization_id, idempotency_key),
  CHECK ((response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
      OR (response_status BETWEEN 200 AND 599 AND response_body IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX identity_admin_idempotency_created_idx
  ON identity_admin_idempotency_keys (created_at);

COMMIT;
