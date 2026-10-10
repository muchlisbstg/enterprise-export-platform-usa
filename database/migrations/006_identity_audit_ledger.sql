-- Append-oriented audit ledger for identity, membership, and role administration.
-- No users, memberships, or roles are provisioned by this migration.
BEGIN;

CREATE TABLE identity_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(trim(request_key)) BETWEEN 8 AND 160),
  actor_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'identity.reconcile',
    'membership.invite',
    'membership.activate',
    'membership.suspend',
    'membership.revoke',
    'role.grant',
    'role.revoke'
  )),
  decision text NOT NULL CHECK (decision IN ('allowed', 'denied', 'failed')),
  reason text CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 1000),
  role_key text REFERENCES authorization_roles(role_key) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, request_key)
);

CREATE INDEX identity_audit_events_org_time_idx
  ON identity_audit_events (organization_id, occurred_at DESC);
CREATE INDEX identity_audit_events_target_time_idx
  ON identity_audit_events (target_user_id, occurred_at DESC);
CREATE INDEX identity_audit_events_correlation_idx
  ON identity_audit_events (correlation_id);

COMMENT ON TABLE identity_audit_events IS
  'Audit evidence for identity and tenant membership administration. Never store access tokens, secrets, or raw authorization headers in metadata.';

COMMIT;
