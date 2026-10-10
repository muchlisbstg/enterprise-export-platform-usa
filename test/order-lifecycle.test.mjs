import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOrderTransition, listOrderTransitions } from "../src/order-lifecycle.mjs";

const actor = (overrides = {}) => ({
  id: "user-approver",
  organizationId: "org-a",
  permissions: ["order:submit", "order:approve", "order:reject", "order:cancel", "order:fulfil"],
  ...overrides
});
const order = (overrides = {}) => ({
  id: "order-1",
  organizationId: "org-a",
  status: "submitted",
  createdBy: "user-sales",
  ...overrides
});

test("allows an authorized submission from draft", () => {
  const result = evaluateOrderTransition({
    order: order({ status: "draft" }),
    actor: actor(),
    action: "submit"
  });
  assert.equal(result.allowed, true);
  assert.equal(result.from, "draft");
  assert.equal(result.to, "submitted");
});

test("denies an actor without the required permission", () => {
  const result = evaluateOrderTransition({
    order: order({ status: "draft" }),
    actor: actor({ permissions: ["order:read"] }),
    action: "submit"
  });
  assert.equal(result.code, "FORBIDDEN");
});

test("does not reveal cross-organization order availability", () => {
  const result = evaluateOrderTransition({
    order: order({ organizationId: "org-b" }),
    actor: actor(),
    action: "approve"
  });
  assert.equal(result.code, "ORDER_NOT_FOUND");
});

test("enforces separation of duties for approval by default", () => {
  const result = evaluateOrderTransition({
    order: order({ createdBy: "user-approver" }),
    actor: actor(),
    action: "approve"
  });
  assert.equal(result.code, "SEPARATION_OF_DUTIES");
});

test("allows self-approval only when an explicit policy disables separation of duties", () => {
  const result = evaluateOrderTransition({
    order: order({ createdBy: "user-approver" }),
    actor: actor(),
    action: "approve",
    enforceSeparationOfDuties: false
  });
  assert.equal(result.allowed, true);
  assert.equal(result.to, "approved");
});

test("requires a meaningful reason to reject or cancel", () => {
  const reject = evaluateOrderTransition({ order: order(), actor: actor(), action: "reject", reason: "  " });
  const cancel = evaluateOrderTransition({ order: order({ status: "draft" }), actor: actor(), action: "cancel", reason: "no" });
  assert.equal(reject.code, "REASON_REQUIRED");
  assert.equal(cancel.code, "REASON_REQUIRED");
});

test("rejects invalid state transitions and unsupported actions", () => {
  const result = evaluateOrderTransition({
    order: order({ status: "rejected" }),
    actor: actor(),
    action: "fulfil"
  });
  assert.equal(result.code, "INVALID_STATE_TRANSITION");
  assert.equal(evaluateOrderTransition({ order: order(), actor: actor(), action: "delete" }).code, "INVALID_ACTION");
});

test("trims and returns the recorded reason", () => {
  const result = evaluateOrderTransition({
    order: order(),
    actor: actor(),
    action: "reject",
    reason: "  Price needs review  "
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "Price needs review");
});

test("exposes a stable, explicit transition inventory", () => {
  const transitions = listOrderTransitions();
  assert.deepEqual(transitions.map(item => item.action), ["submit", "approve", "reject", "cancel", "fulfil"]);
});
