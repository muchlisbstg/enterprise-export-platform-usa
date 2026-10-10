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
