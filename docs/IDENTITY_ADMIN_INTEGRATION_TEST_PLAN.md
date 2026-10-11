# Identity Admin Integration Test Plan

Status: planned test coverage; this document is not evidence that these tests already exist or have passed.

## Objective

Establish database-backed evidence for the identity role grant/revoke service before any admin HTTP routes are exposed. Tests should exercise the real PostgreSQL schema and transaction boundaries, not only mocks.

## Preconditions

- Apply migrations 001–007 to an isolated test database.
- Use dedicated tenant, user, membership, role, permission, and audit fixtures.
- Keep provider credentials and production data out of test fixtures and logs.
- Run each test with deterministic cleanup or an isolated schema/database.
- Do not grant elevated permissions to a real account as part of test setup.

## Required test matrix

| Scenario | Setup | Expected assertion |
|---|---|---|
| Grant allowed role | Actor has `roles:grant`; target has active membership in the same tenant | Grant is persisted and one audit event is committed |
| Revoke assigned role | Actor has `roles:revoke`; target has the role | Assignment is removed and audit event is committed |
| Idempotent replay | Repeat same operation with same tenant-scoped key and same request | Second response is replay-safe; no duplicate grant or audit side effect |
| Idempotency key conflict | Reuse key for a different operation or request fingerprint | Conflict is returned; original operation remains unchanged |
| Cross-tenant target | Actor's tenant differs from target membership tenant | Denied; no role mutation or success audit event |
| Inactive/missing membership | Target has no active membership in actor tenant | Denied; no mutation |
| Self-role change | Actor attempts to grant/revoke their own role | Denied; no mutation |
| Unauthorized actor | Actor lacks operation-specific permission | Denied; no mutation |
| Invalid role | Requested role is not on the service allowlist | Denied; no mutation |
| Audit insert failure | Force audit write to fail after attempted mutation | Entire transaction rolls back, including role assignment change |
| Concurrent duplicate | Run same idempotent request concurrently | At most one logical mutation and consistent replay/conflict result |
| Request-key boundary | Test accepted maximum (160 chars) and rejected 161 chars | 160 accepted subject to normal validation; 161 rejected before DB access |

## Test mechanics

1. Prefer a disposable PostgreSQL service in CI or a dedicated integration-test job.
2. Assert database state and audit rows after each operation, not only returned status values.
3. Include a concurrency test that uses separate database connections.
4. Confirm transaction rollback by querying state after an induced audit failure.
5. Record the migration version and CI run URL in the pull request when tests are implemented.

## Exit criteria before admin routes

- [ ] All scenarios above have executable PostgreSQL-backed tests.
- [ ] Integration suite passes on the proposed commit and on the merge commit.
- [ ] Cross-tenant, self-change, and unauthorized paths assert no mutation.
- [ ] Audit failure test proves transaction rollback.
- [ ] A reviewer checks permission naming, idempotency fingerprinting, locking, and audit semantics.
- [ ] Bootstrap process receives separate two-person review.
- [ ] Only then propose admin route wiring in a separate pull request.

## Security and release boundary

This plan does not claim that integration coverage exists, that a staging environment is configured, or that the platform is deployed or certified. Do not automatically grant `roles:grant` or `roles:revoke`. Production changes and elevated access require explicit human approval.
