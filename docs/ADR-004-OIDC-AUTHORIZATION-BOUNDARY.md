# ADR-004: OIDC Authentication and API Authorization Boundary

- Status: Proposed
- Date: 2026-10-10
- Scope: API identity and authorization for the Enterprise Export Platform
- This ADR is a design decision record; it does not implement authentication or establish compliance.

## Context

The API currently authenticates protected routes with one configured shared bearer token and scopes database queries to one configured organization ID. Migration 003 introduces user, membership, role, and permission tables, but those tables alone do not authenticate a person or enforce route permissions. The order lifecycle policy is also a pure policy module and is not yet wired into HTTP routes and database transactions.

A shared token cannot identify individual users, distinguish their organization memberships, or support reliable separation-of-duties checks. Replacing it with an unverified JWT parser would be worse: token claims must not be trusted without cryptographic verification.

## Decision

Adopt OpenID Connect (OIDC) Authorization Code flow with PKCE for interactive clients and a standards-compliant access-token validation library for API requests. The API must validate access tokens against a configured trusted issuer and audience. It must not accept an ID token as an API access token.

The exact identity provider is intentionally not hard-coded in this ADR. Before implementation, select and document a provider and its supported access-token format, issuer, audience, JWKS discovery behavior, key rotation behavior, required claims, and local development strategy.

## Token validation contract

For every protected request, authentication must fail closed unless all required checks pass:

1. Extract exactly one Bearer token from the Authorization header.
2. Verify the token signature with keys obtained from the configured issuer's trusted metadata/JWKS endpoint; do not follow a token-supplied arbitrary key URL.
3. Allow only explicitly configured signing algorithms; reject `none` and unexpected algorithms.
4. Validate `iss`, `aud`, `exp`, `nbf` when present, and required subject/client claims according to the provider contract.
5. Apply bounded clock tolerance and key-cache/rotation behavior supplied by a maintained OIDC/JWT library.
6. Return a generic 401 response for missing, malformed, expired, invalid-signature, wrong-issuer, or wrong-audience tokens. Never log the token.
7. Treat validated claims as identity evidence only; do not infer organization permissions from arbitrary client-supplied headers or untrusted custom claims.

## Principal and tenant resolution

- Resolve the external identity using the validated issuer plus subject pair (`iss`, `sub`) and map it to `app_users`.
- Resolve the requested organization from an explicit route/resource selection, then verify an active `organization_memberships` record for the authenticated user.
- Derive the organization scope from that verified membership, not a global `DEFAULT_ORGANIZATION_ID` or an untrusted request header.
- Resolve permissions through active membership-role assignments and role-permission links. Missing user mapping, membership, role, or permission means deny.
- Avoid returning whether a foreign tenant's resource exists; use a consistent not-found/denied policy and test it.

## Authorization contract

- Use a central authorization function with explicit action/resource/organization inputs.
- Read actions require the corresponding read permission; writes require the exact write/action permission.
- Order transitions must call the existing pure lifecycle policy with the authenticated actor and resolved organization context.
- State validation, authorization, transition update, and audit insertion must be part of a single database transaction with concurrency protection (for example, row locking or a conditional update).
- Enforce separation of duties where configured: the actor who submitted an order must not approve that same order.
- Record actor, organization, action, decision, correlation ID, resource ID, and reason/evidence in the audit trail. Never store raw bearer tokens or sensitive claims in audit logs.

## Configuration and operations

Required configuration should include trusted issuer URL, expected audience, and provider-specific settings validated at startup. Missing or inconsistent configuration must prevent protected API startup rather than silently falling back to the shared token. Secrets must come from the deployment secret manager and must never be committed.

Key rotation, provider outage behavior, clock skew, rate limiting, request correlation, and safe authentication error responses need explicit tests and operational documentation.

## Migration plan

1. Select the OIDC provider and record its concrete issuer/audience/claims contract.
2. Add a maintained token-validation dependency and unit tests for valid, expired, wrong-issuer, wrong-audience, malformed, and key-rotation cases.
3. Add an authenticated principal resolver and membership/permission query layer; keep tenant selection server-verified.
4. Add route-level authorization tests for every protected route, including no membership, inactive membership, missing permission, and cross-tenant access.
5. Wire order lifecycle transitions only after authenticated actor identity and permission checks are verified; test separation of duties and concurrent transitions.
6. Run PostgreSQL integration tests and security-focused CI checks. Remove the shared-token fallback only after the new path is fully configured and tested in each target environment.

## Acceptance criteria

- No protected route accepts a token that has not been cryptographically verified.
- Issuer and audience are checked explicitly.
- Tenant scope is resolved from a verified membership.
- Denial is the default when identity or authorization evidence is absent.
- Automated tests cover token failures, permission failures, cross-tenant access, and lifecycle authorization.
- Logs and errors do not expose tokens or sensitive identity data.
- Existing integration tests continue to pass.

## Current limitations

This ADR does not add an OIDC provider, token verification, login/session flow, principal resolution, route-level RBAC, or production configuration. Until those are implemented and tested, the existing shared-token mechanism remains a prototype limitation and must not be described as enterprise-ready authentication.
