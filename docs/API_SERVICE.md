# API service: first vertical slice

## Included

- `GET /health`: process-level health response.
- `GET /api/v1/products`: active products for the configured organization.
- `GET /api/v1/parties`: active parties, optionally filtered by kind.
- `GET /api/v1/orders`: organization-scoped orders with their lines, optionally filtered by status.
- Parameterized SQL, bounded list limits, safe error responses, and request correlation IDs.

## Local setup

Requires Node.js 22+, PostgreSQL 14+, and the migration in `database/migrations/001_initial_order_foundation.sql`.

```sh
npm install
export DATABASE_URL='postgres://app:change-me@localhost:5432/export_platform'
export API_BEARER_TOKEN='replace-with-a-secret-at-least-24-characters'
export DEFAULT_ORGANIZATION_ID='UUID_OF_AN_EXISTING_ORGANIZATION'
npm test
npm start
```

The organization must already exist in the database. Do not commit secrets or real customer data.

## Important security boundary

This is an early development slice, not a production authentication system. The bearer token is a single shared secret and the organization scope is configured at process startup. Before production or multi-tenant exposure, replace this with a reviewed identity provider/JWT validation, authorization and membership checks, secret rotation, rate limiting, observability, and security testing. Do not expose this prototype publicly or treat a client-supplied organization ID as trusted identity.

## Not implemented yet

- Creating or updating orders, idempotency, order submission/approval, inventory reservation, and export-document generation.
- Cursor pagination (the current `nextCursor` is always `null`).
- JWT/OIDC authentication, role-based authorization, and multi-tenant identity resolution.
- Deployment, operational readiness, or regulatory/Shariah determinations.
