# Secure Identity Onboarding and Role Provisioning Runbook

Status: implementation plan and operator control specification. This document does not implement an admin API or grant any access.

## Objective

Provide a controlled path from a verified OIDC identity to a tenant-scoped membership and least-privilege role assignment without self-service privilege escalation.

## Current facts

- OIDC JWT verification and tenant principal resolution are implemented in the API runtime.
- The app_users table maps a verified identity_issuer + identity_subject pair to a local user.
- organization_memberships stores tenant membership status.
- organization_membership_roles assigns roles to a specific membership.
- Migration 004 seeds permission vocabulary and system-managed role templates, but grants no roles to users.
- There is not yet an admin endpoint, invite/onboarding flow, or audited bootstrap command. Do not describe this platform as ready for customer onboarding.

## Required workflow

1. Verify the identity provider: configure OIDC_ISSUER and OIDC_AUDIENCE from trusted provider configuration; validate the discovery issuer and HTTPS JWKS endpoint. Provider selection and environment setup must be recorded separately.
2. Approve tenant onboarding: obtain an organization identifier through an authenticated internal process. Never accept a user-supplied organization ID as proof of access.
3. Resolve identity: after signature, issuer, audience, expiry, and required claim checks, identify the principal only by the verified issuer and subject. Do not use email as the unique identity key.
4. Create or reconcile user: use a transaction and the unique issuer/subject constraint. Treat conflicting identity metadata as a review case; do not silently rebind an identity.
5. Create membership: create a pending/invited membership, then activate only after an authorized tenant-administrator approval. Suspended/revoked memberships must not authenticate for that tenant.
6. Grant least-privilege role: select from the approved role catalog; require a separate authorized grantor. A user must not grant or elevate their own roles. System-managed role templates cannot be edited through tenant administration.
7. Audit: record request/correlation ID, tenant, target user, action, prior/new status or role, grantor identity, reason/ticket, timestamp, and outcome. Never log bearer tokens or secrets.
8. Verify: test the resulting permissions through the same principal resolver used by protected routes. Verify denial for cross-tenant access, disabled users, inactive membership, missing role, and self-approval.
9. Revoke safely: deactivate membership or remove a role through an audited transaction. Preserve audit evidence and ensure authorization changes take effect promptly.

## Required implementation controls

- Admin operations must authenticate using OIDC and enforce a dedicated permission such as identity:manage or roles:grant, added through a reviewed migration.
- Grantor must be an active member of the target organization with the administrative permission.
- Do not expose arbitrary SQL, role-key creation, or permission-catalog mutation to tenant admins.
- Role grants and audit records must commit in the same database transaction.
- Use row locks or equivalent concurrency controls for membership and role changes.
- Enforce idempotency for retried administrative requests and reject conflicting reuse.
- Enforce separation of duties for high-impact grants; a grantor cannot grant elevated access to themselves.
- Add rate limiting, input validation, structured audit events, and tests for authorization failures.
- Protect the bootstrap path with a one-time, out-of-band operational process; never ship a default admin identity or seed a production administrator automatically.

## Acceptance tests before staging

- New verified identity can be provisioned only through an authorized workflow.
- Duplicate issuer/subject cannot create a second user.
- Unapproved membership remains denied.
- A grantor without tenant-scoped grant permission is denied.
- Self-grant and unauthorized role escalation are denied.
- System-managed role templates cannot be changed by tenant administrators.
- Every successful and rejected administrative mutation produces an auditable outcome without recording credentials.
- Revoked membership and removed roles stop authorizing subsequent requests.
- Cross-tenant reads and mutations remain denied.
- Database failures roll back both the role change and its audit record.

## Release gates

Do not enable customer onboarding until the admin workflow, migration, integration tests, operational bootstrap procedure, and security review are complete. Provider configuration, staging deployment, and production deployment are separate gates. No export-law compliance or certification is implied by this runbook.
