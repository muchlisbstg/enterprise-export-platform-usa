# Order API Integration Test Plan

## Objective

Extend the current API unit tests and migration smoke checks with repeatable PostgreSQL-backed tests for order creation. The current CI applies migrations to a disposable PostgreSQL instance but does not yet exercise the complete HTTP-to-database transaction path.

## Test environment

- Node.js 22, pinned dependencies, and a disposable PostgreSQL database.
- Apply migrations in order: `001_initial_order_foundation.sql`, then `002_order_idempotency.sql`.
- Use synthetic fixtures only: two organizations, one active customer per organization, and products that include active and inactive cases.
- Never point CI tests at staging or production databases.
- Clean up by rolling back a test transaction where feasible, or recreate the database for each test suite.

## Required scenarios

| Area | Scenario | Expected result |
|---|---|---|
| Happy path | Valid order with multiple lines | Draft order, line rows, audit event, and idempotency response commit together |
| Atomicity | Force a failure after inserting the order header | No partial order, lines, audit event, or completed idempotency response remains |
| Replay | Repeat the same key and canonical request | Original successful response is replayed; no duplicate order or audit event |
| Key conflict | Reuse a key with a different request body | HTTP 409 and no additional business writes |
| Tenant isolation | Customer belongs to another organization | Request rejected; no cross-tenant order created |
| Tenant isolation | Product belongs to another organization | Request rejected; no cross-tenant product referenced |
| Product state | Inactive customer or product | Request rejected |
| Uniqueness | Duplicate order number within its required scope | HTTP 409; transaction leaves no partial writes |
| Validation | Invalid UUID, currency, quantity, price, or line count | HTTP 400 before business writes |
| Body handling | Malformed JSON and body above 64 KiB | HTTP 400 and 413 respectively |
| Concurrency | Two simultaneous requests use the same key and body | At most one order; both requests resolve to the same result or a documented retryable outcome |
| Database failure | Connection loss before commit | Safe error response; retry with the same key does not duplicate a committed order |

## Assertions

For each scenario, assert both the HTTP response and the database state. Check organization IDs on all inserted records and verify foreign-key/unique constraints. Avoid asserting implementation-specific SQL text when a behavioral assertion can prove the invariant.

## Suggested test architecture

1. Export fixture builders that create organization/customer/product rows with randomized UUIDs.
2. Start the HTTP handler on an ephemeral loopback port.
3. Use a real `pg.Pool` against the disposable CI database.
4. Wrap each test in isolated fixtures and remove dependent rows in foreign-key-safe order.
5. Run the suite serially initially; introduce parallelism only after isolation is proven.
6. Include an explicit fault-injection seam for transaction failure tests rather than relying on timing.

## Acceptance gate

- [ ] Happy path and replay tests pass against PostgreSQL.
- [ ] Key mismatch, tenant isolation, and duplicate order tests pass.
- [ ] Failure-injection test proves atomic rollback.
- [ ] Concurrent replay test has deterministic assertions.
- [ ] CI uses only disposable test credentials and database instances.
- [ ] OpenAPI responses and status codes match observed behavior.

## Security and production limitations

The current bearer token and process-configured organization are development scaffolding, not production identity or authorization. Do not expose the service publicly or use real customer data until authentication, authorization, secret management, rate limiting, operational monitoring, and a security review are implemented. This plan is not a claim of regulatory, export-control, sanctions, tax, privacy, or other compliance.
