# Security Hardening and Release Gates

## Status and intent

This document is a proposed engineering checklist for the Enterprise Export Platform. It is not evidence that any control is implemented, tested, certified, or legally compliant. Each item must be validated against the actual code, deployment, threat model, and applicable jurisdiction before being marked complete.

## 1. Repository and change governance

- [x] Repository visibility was verified as public on 2026-10-11 and is intentionally unchanged per the current owner instruction. Reassess visibility separately only if the access policy changes.
- [ ] Protect `main`: require pull requests, required reviews, and passing required checks before merge.
- [ ] Restrict force pushes and branch deletion on protected branches.
- [ ] Define who may approve security-sensitive changes and who may deploy to each environment.
- [ ] Keep credentials, tokens, private keys, production data, and sensitive customer information out of Git history and logs.
- [ ] Enable secret scanning and dependency/security alerts where available; document remediation ownership.

## 2. CI and release evidence

- [ ] Identify the authoritative workflow files and required checks for this repository.
- [ ] Run lint, formatting, type checks, unit tests, and integration tests on pull requests.
- [ ] Run PostgreSQL integration tests against a disposable, version-pinned service.
- [ ] Test concurrency, retries, duplicate requests, transaction rollback, and failure recovery.
- [ ] Pin third-party GitHub Actions to reviewed immutable commit SHAs where practical.
- [ ] Publish test reports and retain enough evidence to identify the exact commit tested.
- [ ] Block release when a required check is missing, skipped unexpectedly, or failing.
- [ ] Require explicit human approval for production deployment and destructive operations.

## 3. Identity and authorization

- [ ] Validate OIDC issuer, audience, signature, expiry, not-before, and allowed algorithms against trusted configuration.
- [ ] Resolve tenant and principal identity from verified claims; never trust tenant IDs supplied only by a client request.
- [ ] Enforce authorization server-side for every protected operation and object.
- [ ] Apply least privilege and separation of duties to role grants and administrative actions.
- [ ] Make identity provisioning and role changes idempotent under retries and concurrent requests.
- [ ] Ensure audit records capture actor, action, target, outcome, timestamp, and correlation ID without storing bearer tokens or secrets.
- [ ] Test revoked users, disabled accounts, cross-tenant access, privilege escalation, malformed tokens, and replay attempts.

## 4. API and order lifecycle

- [ ] Define explicit state-transition rules and reject illegal transitions.
- [ ] Use idempotency keys for operations that may be retried; scope keys to principal/tenant and operation.
- [ ] Enforce database constraints and transactional consistency for state changes and audit records.
- [ ] Test concurrent updates, duplicate submissions, timeouts after commit, and rollback paths.
- [ ] Validate inputs at the API boundary and return consistent, non-sensitive error responses.
- [ ] Add pagination limits, rate limiting, request correlation, and operational metrics.

## 5. Database and operational security

- [ ] Use separate least-privilege database identities per service/environment.
- [ ] Store secrets in an approved secret manager and rotate them using a documented procedure.
- [ ] Verify tenant isolation in both application authorization and database access patterns.
- [ ] Define backup retention, restore tests, migration rollback strategy, and recovery objectives.
- [ ] Avoid logging credentials, payment details, unnecessary personal data, or full sensitive payloads.
- [ ] Define retention and access rules for audit logs; use tamper-evident storage where required.

## 6. Shariah and regulatory governance boundaries

- [ ] Keep Shariah policy decisions, statutory trade controls, sanctions screening, privacy, tax, and accounting controls distinct.
- [ ] Record the policy owner, authoritative source, version, effective date, review date, and approval evidence for each configurable rule.
- [ ] Route uncertain cases and exceptions to qualified human reviewers.
- [ ] Do not label a transaction or product compliant based only on incomplete automated checks.
- [ ] Have qualified legal, export-control, privacy, accounting, and Shariah advisers assess the actual use case and jurisdictions before production use.

## 7. Definition of release readiness

A release may be considered for approval only when:
1. Required checks are green for the exact candidate commit.
2. Security-sensitive changes have the required human review.
3. Open blockers and known limitations are documented and accepted by an authorized owner.
4. Migration, rollback, monitoring, and incident-response steps are reviewed.
5. Production approval is recorded separately from automated AI or CI recommendations.

## Evidence log

For each completed item, record the evidence link, tested commit SHA, reviewer/owner, date, result, and any accepted limitation. Do not mark items complete based on this checklist alone.
