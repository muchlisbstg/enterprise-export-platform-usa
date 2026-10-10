-- Enterprise Export Platform USA
-- Initial logical schema for the MVP vertical slice.
-- Apply only to a disposable development/test database until reviewed.
-- PostgreSQL 14+; gen_random_uuid() is provided by PostgreSQL.
BEGIN;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL CHECK (length(trim(legal_name)) BETWEEN 1 AND 240),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, legal_name)
);

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('customer', 'supplier', 'both')),
  legal_name text NOT NULL CHECK (length(trim(legal_name)) BETWEEN 1 AND 240),
  country_code char(2) CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE INDEX parties_org_name_idx ON parties (organization_id, lower(legal_name));

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  sku text NOT NULL CHECK (length(trim(sku)) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 240),
  description text,
  unit_of_measure text NOT NULL CHECK (length(trim(unit_of_measure)) BETWEEN 1 AND 24),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, sku)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  customer_party_id uuid NOT NULL,
  order_number text NOT NULL CHECK (length(trim(order_number)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'fulfilled')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, order_number),
  FOREIGN KEY (organization_id, customer_party_id)
    REFERENCES parties (organization_id, id)
);

CREATE INDEX orders_org_status_created_idx
  ON orders (organization_id, status, created_at DESC);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, order_id, line_number),
  FOREIGN KEY (organization_id, order_id)
    REFERENCES orders (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, product_id)
    REFERENCES products (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  correlation_id uuid NOT NULL,
  actor_id uuid,
  subject_type text NOT NULL CHECK (length(trim(subject_type)) BETWEEN 1 AND 80),
  subject_id uuid,
  action text NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 120),
  decision text CHECK (decision IS NULL OR decision IN ('allowed', 'denied', 'approved', 'rejected')),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_org_time_idx
  ON audit_events (organization_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id);

COMMIT;
