# Enterprise Export Platform USA — MVP Backlog

> Planning backlog only. Items are not complete until implemented and supported by test evidence.

## P0 — Discovery and guardrails

- [ ] Confirm pilot business, goods, export destinations, legal entities, and user roles.
- [ ] Define MVP workflow from customer inquiry through order, shipment, and document closeout.
- [ ] Create a data dictionary and stable identifiers for products, parties, orders, and shipments.
- [ ] Define roles, tenant/entity boundaries, and segregation of duties.
- [ ] Select deployment model, supported environments, backup, and recovery objectives.
- [ ] Identify policy owners and authoritative sources for any export-control or sanctions-related workflow.

**Acceptance:** signed-off scope, process map, data classification, permission matrix, and risk register.

## P1 — Foundation

- [ ] Establish language/runtime and repository conventions.
- [ ] Add CI for formatting/lint, unit tests, dependency checks, and build.
- [ ] Define configuration validation and safe environment-variable handling.
- [ ] Design PostgreSQL migrations and seed strategy for non-sensitive development data.
- [ ] Define API versioning, request validation, pagination, and stable error response.
- [ ] Define audit-event schema and correlation ID propagation.

**Acceptance:** clean install and repeatable CI; no production secrets in source control.

## P2 — First vertical slice

- [ ] Organization and user-role model.
- [ ] Product catalog and units of measure.
- [ ] Customer/supplier party records.
- [ ] Quotation and order lifecycle with explicit state transitions.
- [ ] Approval request, approve/reject decision, and evidence record.
- [ ] Basic search, filtering, and export of authorized records.

**Acceptance:** end-to-end tests cover successful and denied access, invalid transitions, duplicates, and concurrent updates.

## P3 — Export operations

- [ ] Shipment record and milestone timeline.
- [ ] Document checklist with versioned metadata.
- [ ] Exception queue for missing or conflicting information.
- [ ] Human review of policy exceptions.
- [ ] Integration adapter contract and retry/dead-letter behavior.

**Acceptance:** test fixtures demonstrate traceability from order to shipment documents and approvals.

## P4 — Operations and hardening

- [ ] Structured logs, metrics, and actionable alerts.
- [ ] Backup/restore exercise and documented recovery procedure.
- [ ] Security review of authentication, authorization, file access, and tenant boundaries.
- [ ] Load tests for the agreed pilot volume.
- [ ] Staging smoke tests and rollback runbook.
- [ ] Accessibility review for primary workflows.

**Acceptance:** review evidence attached to a release candidate; unresolved critical issues block release.

## Out of scope for initial MVP

- Automatic legal determinations or export-license decisions.
- Automatic sanctions clearance without qualified review.
- Shariah certification or automated religious rulings.
- Broad, exhaustive support for all countries and industries.
- Claims of production readiness before operational validation.

## Suggested first sprint

1. Confirm scope and roles.
2. Write the workflow and acceptance criteria.
3. Establish CI and migration/test conventions.
4. Implement organization, product, and party schemas.
5. Deliver one end-to-end quotation-to-order path with audit events.
