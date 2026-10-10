# Identity and Authorization Foundation

> Status: schema foundation only. No identity provider, token verifier, login flow, API credential authentication, or route-level RBAC is implemented by this change.

## Purpose

This migration establishes storage primitives for mapping a verified external identity to a local user, assigning tenant memberships, and defining permission-based roles. It is intentionally separate from HTTP authorization so schema creation cannot be mistaken for secure authentication.

## Data model

- `app_users`: external identity issuer + subject pair, optional display metadata, and a disable marker. The issuer/subject pair is unique; email is not an identity key.
- `organization_memberships`: explicit membership and lifecycle status for a user in an organization.
- `authorization_roles` and `authorization_permissions`: stable role and permission catalog.
- `authorization_role_permissions`: many-to-many role/permission grants.
- `organization_membership_roles`: role assignments scoped to a particular organization, with an optional granting user.

Memberships and role assignments are tenant-scoped by composite foreign keys. Revoking a membership must not silently delete its audit history or related assignments.

## Required implementation before use

1. Choose and configure a supported OIDC identity provider.
2. Verify issuer, audience, signature, expiry, and required claims server-side; never trust caller-supplied user IDs or organization IDs.
3. Resolve the verified issuer/subject to `app_users`, then load active membership and permission grants for the requested organization.
4. Replace the shared static bearer-token gate with the verified principal pipeline before enabling user-specific actions.
5. Derive the actor and tenant scope server-side; enforce least privilege and separation of duties on every read and mutation.
6. Add tests for invalid/expired tokens, disabled users, revoked/suspended membership, unknown issuer/subject, cross-tenant access, and permission denial.
7. Add audited administrative workflows for membership and role grants; do not let a user grant themselves privileges.

## Explicit non-goals

- This migration does not seed roles or permissions.
- It does not verify tokens or create sessions.
- It does not make the existing `API_BEARER_TOKEN` multi-user aware.
- It does not enable order transition endpoints.
- It does not claim production readiness, legal/export compliance, or certification.

The current API remains a constrained single-organization bearer-token pilot until the authentication and authorization implementation passes review and integration tests.


## OIDC API runtime configuration

The API server now requires `OIDC_ISSUER` and `OIDC_AUDIENCE`. At startup it reads the issuer's OpenID Connect discovery document and uses the advertised JWKS endpoint for cryptographic access-token verification. The configured issuer must exactly match the discovery document issuer, and the JWKS endpoint must use HTTPS (loopback HTTP is permitted only for local development). Supported token signature algorithms are explicitly allowlisted in code. The API expects JWT access tokens; opaque access tokens are not supported by this verifier.

For protected routes, clients send an `Authorization: Bearer <access-token>` header and an `X-Organization-Id` header. The API resolves the verified issuer/subject pair against `app_users`, then requires an active membership for that organization and the route's permission. The organization header selects a candidate tenant only; it does not grant access.

## Permission and role catalog

Migration `004_authorization_catalog.sql` seeds permission names and system-managed role templates. It deliberately does not assign any role to a user. Provisioning an identity, membership, or role assignment must be performed through a separately authorized and audited administrative process. Until the caller has an active membership and the required role assignment, protected routes deny access.

The seeded lifecycle permissions describe the intended policy vocabulary; lifecycle transition endpoints are not enabled by this migration. A role template or permission record is not evidence that the corresponding business action is implemented.
