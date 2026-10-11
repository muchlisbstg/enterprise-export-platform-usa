# First Administrator Bootstrap Safety Runbook

Status: **proposed operational procedure — not executed and not an implemented bootstrap command**.

## Purpose and boundary

Define minimum controls for establishing the first tenant administrator without creating a default production account, a shared bootstrap password, or an ordinary API path for self-elevation. This runbook does not grant roles, create credentials, select an identity provider, or authorize production access.

## Preconditions

Do not begin until all of the following are true:

- The target organization and its legal/operational owner have been verified through an approved process.
- An identity provider and issuer/subject mapping policy have been selected for the target environment.
- The identity to be provisioned has authenticated through the selected provider and its identity is independently verified.
- The exact organization, user, initial role, business justification, and expiry/review date are recorded in a change request.
- Two distinct human approvers are assigned. The requester cannot approve their own request.
- A tested backup/recovery procedure and an audit retention policy are available.
- The operation will be performed by an authorized operator through a controlled, logged channel—not by an unauthenticated HTTP endpoint.

## Required authorization controls

1. Confirm the target organization and active identity mapping; never accept an arbitrary user ID from an untrusted request.
2. Require two-person approval for the initial privileged grant. Record both approvals and timestamps in the change record.
3. Grant only the minimum role required for administration. Do not grant broad database, infrastructure, or global-account privileges by default.
4. Do not create or seed a default administrator, static password, reusable token, or permanent bootstrap secret.
5. Do not grant `roles:grant` or `roles:revoke` automatically through a migration.
6. Record the actor, target, organization, requested role, reason, approval references, correlation ID, and outcome in the audit ledger. Never record tokens, secrets, authorization headers, or raw provider claims.
7. Ensure the identity mutation and its audit record commit atomically. If audit persistence fails, roll back the mutation.
8. After the initial grant, verify the intended permissions with positive and negative tests, then remove temporary operator access and close the change record.

## Execution record template

Create a restricted operational record containing:

- Change/ticket reference:
- Environment and organization identifier:
- Identity provider issuer and subject reference (no tokens or raw claims):
- Requested role and justification:
- Requester:
- Approver 1 and approval timestamp:
- Approver 2 and approval timestamp:
- Operator and execution timestamp:
- Correlation ID:
- Result and audit-event reference:
- Permission verification evidence:
- Temporary-access revocation evidence:
- Rollback/recovery outcome, if applicable:

Do not put credentials or secrets in this record or in source control.

## Failure and rollback

- If identity verification or either approval is missing, stop without making changes.
- If the target organization or membership cannot be confirmed, stop and do not disclose cross-tenant existence.
- If the audit write fails or transaction state is uncertain, treat the operation as failed; reconcile using the audit/change record before retrying.
- If the granted permissions exceed the approved scope, revoke the excess grant through a separately logged, reviewed operation and investigate.
- Never bypass controls to meet a delivery deadline.

## Verification required before the procedure is approved

- [ ] Security/operations owner reviews and approves this runbook.
- [ ] Exact operator mechanism and access policy are documented.
- [ ] PostgreSQL integration test proves atomic role mutation and audit persistence.
- [ ] Negative tests cover missing approval, wrong tenant, self-elevation, duplicate request, and audit failure.
- [ ] Recovery/rollback rehearsal is completed in a disposable environment.
- [ ] Staging run uses real provider-issued tokens without exposing secrets.
- [ ] Human approval is recorded before any production use.

## Current implementation status

The repository contains OIDC verification, tenant principal resolution, authorization catalog and audit-ledger foundations, plus a transactional role grant/revoke service. The procedure above remains proposed. There is no claim that first-admin bootstrap has been run, HTTP identity-administration routes have been enabled, staging has been configured, or production has been deployed.
