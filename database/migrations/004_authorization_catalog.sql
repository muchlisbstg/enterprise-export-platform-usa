-- Seed the permission vocabulary and system-managed role templates.
-- This migration deliberately grants no role to any user or organization membership.
BEGIN;

INSERT INTO authorization_permissions (permission_key, description) VALUES
  ('products:read', 'Read active products within an authorized organization'),
  ('parties:read', 'Read active parties within an authorized organization'),
  ('orders:read', 'Read orders within an authorized organization'),
  ('orders:create', 'Create draft orders within an authorized organization'),
  ('order:submit', 'Submit a draft order for review'),
  ('order:approve', 'Approve a submitted order'),
  ('order:reject', 'Reject a submitted order with a reason'),
  ('order:cancel', 'Cancel an eligible order with a reason'),
  ('order:fulfil', 'Mark an approved order as fulfilled')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO authorization_roles (role_key, description, managed_by) VALUES
  ('export-reader', 'Read products, parties, and orders for an organization', 'system'),
  ('order-creator', 'Read export data and create draft orders', 'system'),
  ('order-submitter', 'Read orders and submit draft orders for review', 'system'),
  ('order-approver', 'Read orders and approve or reject submitted orders', 'system'),
  ('order-canceller', 'Read orders and cancel eligible orders with a reason', 'system'),
  ('order-fulfiller', 'Read orders and mark approved orders as fulfilled', 'system')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO authorization_role_permissions (role_key, permission_key)
SELECT role_key, permission_key
FROM (VALUES
  ('export-reader', 'products:read'),
  ('export-reader', 'parties:read'),
  ('export-reader', 'orders:read'),
  ('order-creator', 'products:read'),
  ('order-creator', 'parties:read'),
  ('order-creator', 'orders:read'),
  ('order-creator', 'orders:create'),
  ('order-submitter', 'orders:read'),
  ('order-submitter', 'order:submit'),
  ('order-approver', 'orders:read'),
  ('order-approver', 'order:approve'),
  ('order-approver', 'order:reject'),
  ('order-canceller', 'orders:read'),
  ('order-canceller', 'order:cancel'),
  ('order-fulfiller', 'orders:read'),
  ('order-fulfiller', 'order:fulfil')
) AS seed(role_key, permission_key)
ON CONFLICT (role_key, permission_key) DO NOTHING;

COMMIT;
