# Identity Administration API Contract

Status: implementation contract; not an implemented API.

## Purpose

Define a narrow, tenant-scoped contract for membership lifecycle and role assignment before adding routes or database mutation code. The existing OIDC principal resolver remains the only source of actor identity. Request bodies must never supply or override the actor identity.

## Proposed routes

All routes require a verified OIDC access token, an active membership in the selected tenant, and the corresponding administration permission.

- `GET /api/v1/organizations/{organizationId}/memberships` — list tenant memberships with bounded pagination.
- `POST /api/v1/organizations/{organizationId}/memberships` — create or reconcile a membership for an already verified identity-provider issuer/subject.
- `POST /api/v1/organizations/{organizationId}/memberships/{userId}/suspend` — suspend an active membership.
- `POST /api/v1/organizations/{organizationId}/memberships/{userId}/revoke` — revoke a membership without deleting historical records.
- `PUT /api/v1/organizations/{organizationId}/memberships/{userId}/roles/{roleKey}` — grant one catalog role.
- `DELETE /api/v1/organizations/{organizationId}/memberships/{userId}/roles/{roleKey}` — revoke one catalog role.

The route set is proposed only. Do not expose it until service, schema, authorization, audit, and integration tests ship together.

## Security invariants

1. Derive actor user ID and tenant permissions from the verified OIDC principal. Never trust actor IDs, permission names, or tenant IDs from a request body.
2. Verify the actor has the dedicated permission for the requested operation and an active membership in the exact tenant.
3. Verify the target user has a membership in that same tenant. Cross-tenant identifiers must not reveal whether a user exists.
4. Do not allow an actor to grant themselves elevated permissions or to create the first administrator through an ordinary API request.
5. System-managed roles cannot be edited or deleted by tenant administrators. Granting a role is limited to an explicit allowlist of assignable role templates.
6. Enforce separation of duties for high-impact grants and revocations; where a second approver is required, the requester cannot approve their own request.
7. Every allowed, denied, and failed mutation must write an `identity_audit_events` record in the same database transaction as the state change when a transaction is available. Audit write failure must roll back the mutation.
8. Require an `Idempotency-Key` and correlation ID for mutation requests. Enforce tenant-scoped uniqueness and return a stable result for a replay with the same request hash; reject key reuse with a different payload.
9. Store only minimal structured metadata in audit events. Never record access tokens, authorization headers, secrets, or raw identity-provider claims.
10. Use generic forbidden/not-found responses for cross-tenant targets; do not disclose tenant membership outside the caller's authorized scope.

## Transaction outline for grant/revoke

Within one transaction:

1. Lock and re-check the actor's active tenant membership and effective permissions.
2. Lock and verify the target membership within the same tenant.
3. Resolve the role from the seeded catalog and reject unknown or non-assignable roles.
4. Apply the membership-role insert/delete using a tenant-scoped predicate.
5. Insert the audit event with actor, target, action, decision, role, correlation ID, request key, and minimal metadata.
6. Persist the idempotency response and commit. On any failure, roll back all state changes.

The service must fail closed when actor or target records cannot be verified. The initial administrator bootstrap is a separate, reviewed out-of-band process with documented identity verification and two-person approval; it is not part of these endpoints.

## Required test coverage before implementation is considered complete

- unauthenticated request and invalid OIDC claims;
- missing administration permission;
- inactive actor membership and inactive target membership;
- cross-tenant target ID;
- unknown role and attempt to assign a non-assignable system role;
- self-grant and self-elevation attempts;
- duplicate grant, repeated revoke, idempotency replay, and idempotency key payload conflict;
- concurrent grant/revoke requests and transaction rollback;
- audit insertion failure rolls back the membership-role change;
- denied/failed requests emit safe audit evidence without secrets;
- pagination bounds and response fields do not expose identity-provider tokens or raw claims;
- bootstrap path requires the documented out-of-band approval evidence.

## Release gates

- Unit and PostgreSQL integration tests pass against a disposable database.
- OpenAPI describes each implemented route and error response.
- Security review confirms tenant isolation, least privilege, self-grant prevention, audit atomicity, and idempotency.
- Staging identity-provider configuration and onboarding are verified by a human operator.
- Production rollout, elevated role grants, and destructive operations require explicit human approval.

## Current implementation boundary

The repository currently has OIDC token verification, tenant principal resolution, a seeded authorization catalog, and the identity audit ledger. This document does not implement membership provisioning, role grant/revoke services, admin endpoints, an identity-provider tenant configuration, or production deployment. CI success is evidence of automated checks, not a security certification or deployment approval.
