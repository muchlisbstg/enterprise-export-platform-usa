# Order Lifecycle and Authorization Design

> Status: implementation design proposal. This document describes required behavior; it does not claim that the lifecycle or role-based authorization is implemented.

## Goals

- Keep order creation separate from submission and approval.
- Make every state transition explicit, authorized, auditable, and concurrency-safe.
- Enforce organization/tenant scope on every order read and write.
- Preserve a human decision for high-impact approval; AI may summarize evidence but must not approve.
- Prevent duplicate or replayed requests from creating duplicate transitions.

## State machine

| Current state | Requested action | Next state | Required authority | Notes |
|---|---|---|---|---|
| — | Create | draft | order:create | Creation stores validated lines and initial audit event |
| draft | Submit | submitted | order:submit | Freeze or version the submitted commercial terms |
| submitted | Approve | approved | order:approve | Approver must be authorized and independent where policy requires |
| submitted | Reject | rejected | order:reject | Require a reason and record evidence reference |
| draft | Cancel | cancelled | order:cancel | Record reason; no silent deletion |
| submitted | Cancel | cancelled | order:cancel_submitted | Optional policy-controlled transition; reason required |
| approved | Fulfil | fulfilled | order:fulfil | Requires fulfillment evidence and policy checks |

No transition is allowed merely because a client sends a target status. The server derives the next state from the persisted state and requested action. Rejected, cancelled, and fulfilled are terminal in the initial MVP unless a separately reviewed reopen/amendment workflow is added.

## API contract proposal

Use action-oriented endpoints rather than a generic status update:

- POST /api/v1/orders/{orderId}/submit
- POST /api/v1/orders/{orderId}/approve
- POST /api/v1/orders/{orderId}/reject
- POST /api/v1/orders/{orderId}/cancel
- POST /api/v1/orders/{orderId}/fulfil

Each mutation should require bearer authentication, organization context derived from trusted server-side identity, an idempotency key, and a request/correlation ID. The path's order ID is never sufficient authorization by itself.

Approval/rejection payloads should include a bounded reason or decision note. The actor identity must come from verified authentication, never a caller-supplied approvedBy field. Do not expose an endpoint that lets a general API token impersonate any user or tenant.

## Authorization model

Start with explicit permissions, not role-name checks scattered through route handlers.

- order:read: read orders in the actor's permitted organization scope.
- order:create: create a draft.
- order:submit: submit a draft.
- order:approve: approve a submitted order within the actor's approval scope.
- order:reject: reject a submitted order within the actor's approval scope.
- order:cancel / order:cancel_submitted: cancel within policy limits.
- order:fulfil: record fulfillment evidence.

Minimum roles are a starting configuration only: Sales Operator (read/create/submit), Order Approver (read/approve/reject), Operations (read/fulfil), and Organization Admin (manage membership and permissions). A single static DEFAULT_ORGANIZATION_ID plus shared bearer token is suitable only for a constrained development pilot; it is not a complete multi-user enterprise identity system.

Enforce least privilege, deny by default, tenant scoping in SQL, and separation of duties where configured. An order creator should not approve their own order when the organization policy requires independent approval.

## Transaction and audit requirements

Within one database transaction:

1. Load the order with tenant scope and lock the row (for example, SELECT ... FOR UPDATE).
2. Verify current state, actor permission, organization scope, and separation-of-duties policy.
3. Validate required evidence and transition-specific fields.
4. Update state using a conditional update and increment a version number.
5. Append an audit event with actor ID, organization ID, action, prior/new state, reason, request ID, timestamp, and evidence references.
6. Persist the idempotency result and commit.

If any step fails, roll back the complete transition. Never write secrets, bearer tokens, or unnecessary personal data into audit logs. Make audit rows append-only to the application role wherever practical.

## Error behavior

- 401 UNAUTHENTICATED: no valid identity.
- 403 FORBIDDEN: authenticated but lacks permission or scope.
- 404 ORDER_NOT_FOUND: order does not exist in the actor's visible organization scope; avoid cross-tenant existence leaks.
- 409 INVALID_STATE_TRANSITION: transition is invalid for the persisted state.
- 409 IDEMPOTENCY_CONFLICT: same key reused with a different canonical payload.
- 409 CONCURRENT_MODIFICATION: version/state changed during the operation.
- 422 VALIDATION_ERROR: missing or invalid reason/evidence.

## Required tests before implementation is considered complete

- Unauthenticated requests cannot mutate orders.
- A user in organization A cannot read or mutate organization B's order.
- Missing permission denies each transition.
- A creator cannot self-approve when separation of duties is enabled.
- Only allowed state transitions succeed; all other transitions return a conflict.
- Concurrent approvals produce one state transition and one effective audit decision.
- Replayed idempotency keys return the original result without duplicate audit events.
- A rejected or cancelled order cannot be fulfilled.
- Audit events preserve actor, scope, action, reason, and prior/new state.
- Tests cover transaction rollback when audit or idempotency persistence fails.

## Rollout gates

1. Implement verified identity and tenant context before exposing the API publicly.
2. Add authorization policy functions and transition endpoints behind tests.
3. Add database constraints and concurrency-safe transactions.
4. Run unit and PostgreSQL integration tests.
5. Review audit retention, secret handling, backup/restore, and operational alerts.
6. Perform security review and a human-approved staging exercise before production.

Do not describe this repository as production-ready, legally compliant, export-authorized, or Shariah-certified based on this design document.
