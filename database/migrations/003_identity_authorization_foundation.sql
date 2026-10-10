-- Identity and authorization schema foundation.
-- This migration stores identity-provider subjects and tenant memberships only.
-- It does NOT authenticate tokens or make the existing shared bearer token user-aware.
BEGIN;

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) BETWEEN 1 AND 500),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) BETWEEN 1 AND 255),
  email text,
  display_name text CHECK (display_name IS NULL OR length(display_name) <= 240),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_issuer, identity_subject)
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_memberships_user_status_idx
  ON organization_memberships (user_id, status);

CREATE TABLE authorization_roles (
  role_key text PRIMARY KEY CHECK (role_key ~ '^[a-z][a-z0-9:_-]{1,79}$'),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  managed_by text NOT NULL DEFAULT 'system'
    CHECK (managed_by IN ('system', 'organization')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE authorization_permissions (
  permission_key text PRIMARY KEY CHECK (permission_key ~ '^[a-z][a-z0-9:_-]{1,119}$'),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500)
);

CREATE TABLE authorization_role_permissions (
  role_key text NOT NULL REFERENCES authorization_roles(role_key) ON DELETE RESTRICT,
  permission_key text NOT NULL REFERENCES authorization_permissions(permission_key) ON DELETE RESTRICT,
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE organization_membership_roles (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_key text NOT NULL REFERENCES authorization_roles(role_key) ON DELETE RESTRICT,
  granted_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, role_key),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships (organization_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX organization_membership_roles_user_idx
  ON organization_membership_roles (user_id, organization_id);

COMMIT;
