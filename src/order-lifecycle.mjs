const TRANSITIONS = Object.freeze({
  submit: Object.freeze({ from: ["draft"], to: "submitted", permission: "order:submit" }),
  approve: Object.freeze({ from: ["submitted"], to: "approved", permission: "order:approve", reasonRequired: false }),
  reject: Object.freeze({ from: ["submitted"], to: "rejected", permission: "order:reject", reasonRequired: true }),
  cancel: Object.freeze({ from: ["draft", "submitted"], to: "cancelled", permission: "order:cancel", reasonRequired: true }),
  fulfil: Object.freeze({ from: ["approved"], to: "fulfilled", permission: "order:fulfil" })
});

const fail = (code, message) => ({ allowed: false, code, message });

/**
 * Pure policy decision for an order transition.
 * Call only with an actor derived from verified authentication and an order
 * loaded using the actor's trusted organization scope.
 * This function does not persist state or replace database-level locking.
 */
export function evaluateOrderTransition({ order, actor, action, reason, enforceSeparationOfDuties = true }) {
  if (!order || typeof order !== "object" || !actor || typeof actor !== "object") {
    return fail("INVALID_CONTEXT", "Order and authenticated actor are required");
  }
  if (!actor.id || !actor.organizationId || !Array.isArray(actor.permissions)) {
    return fail("INVALID_ACTOR", "Actor identity, organization scope, and permissions are required");
  }
  if (actor.organizationId !== order.organizationId) {
    return fail("ORDER_NOT_FOUND", "Order is not available in this organization scope");
  }

  const transition = TRANSITIONS[action];
  if (!transition) return fail("INVALID_ACTION", "Unsupported order action");
  if (!transition.from.includes(order.status)) {
    return fail("INVALID_STATE_TRANSITION", "Action is not allowed from the current order state");
  }
  if (!actor.permissions.includes(transition.permission)) {
    return fail("FORBIDDEN", "Actor lacks the permission required for this action");
  }
  if (action === "approve" && enforceSeparationOfDuties && order.createdBy === actor.id) {
    return fail("SEPARATION_OF_DUTIES", "The order creator cannot approve their own order");
  }
  if (transition.reasonRequired && (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 1000)) {
    return fail("REASON_REQUIRED", "A reason between 3 and 1000 characters is required");
  }

  return {
    allowed: true,
    action,
    from: order.status,
    to: transition.to,
    permission: transition.permission,
    reason: typeof reason === "string" ? reason.trim() : null
  };
}

export function listOrderTransitions() {
  return Object.entries(TRANSITIONS).map(([action, rule]) => ({
    action,
    from: [...rule.from],
    to: rule.to,
    permission: rule.permission,
    reasonRequired: Boolean(rule.reasonRequired)
  }));
}
