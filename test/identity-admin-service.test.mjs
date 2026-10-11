import test from "node:test";
import assert from "node:assert/strict";
import { manageMembershipRole } from "../src/identity-admin-service.mjs";

function createPool({ queries = [], failAt = null } = {}) {
  const state = { queries, released: false, committed: false, rolledBack: false };
  const client = {
    async query(sql, params = []) {
      const entry = { sql: String(sql), params };
      state.queries.push(entry);
      if (failAt && String(sql).includes(failAt)) throw new Error("simulated database failure");
      if (String(sql).includes("INSERT INTO identity_admin_idempotency_keys") && String(sql).includes("ON CONFLICT")) return { rowCount: 1, rows: [{ idempotency_key: params[1] }] };
      if (String(sql).includes("SELECT request_hash")) return { rowCount: 0, rows: [] };
      if (String(sql).includes("SELECT m.user_id")) return { rowCount: 1, rows: [{ userId: params[1], status: "active" }] };
      if (String(sql).includes("SELECT role_key")) return { rowCount: 1, rows: [{ role_key: params[2], managed_by: "system" }] };
      if (String(sql).includes("INSERT INTO organization_membership_roles")) return { rowCount: 1, rows: [] };
      if (String(sql).includes("DELETE FROM organization_membership_roles")) return { rowCount: 1, rows: [] };
      if (String(sql).includes("UPDATE identity_admin_idempotency_keys")) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() { state.released = true; }
  };
  return { state, pool: { connect: async () => client } };
}

const base = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  actor: { id: "22222222-2222-4222-8222-222222222222", organizationId: "11111111-1111-4111-8111-111111111111", permissions: ["roles:grant"] },
  targetUserId: "33333333-3333-4333-8333-333333333333",
  roleKey: "order-creator",
  idempotencyKey: "identity-grant-0001",
  correlationId: "44444444-4444-4444-8444-444444444444"
};

test("role grant requires explicit permission and refuses self-grant", async () => {
  const { pool, state } = createPool();
  const denied = await manageMembershipRole({ pool, ...base, action: "grant", actor: { ...base.actor, permissions: [] } });
  assert.equal(denied.status, 403);
  assert.equal(state.queries.length, 0);
  const self = await manageMembershipRole({ pool, ...base, targetUserId: base.actor.id, action: "grant" });
  assert.equal(self.status, 403);
});

test("role grant uses one transaction and writes audit evidence", async () => {
  const { pool, state } = createPool();
  const result = await manageMembershipRole({ pool, ...base, action: "grant" });
  assert.equal(result.status, 200);
  assert.ok(state.queries.some(q => q.sql.includes("INSERT INTO identity_audit_events")));
  assert.ok(state.queries.some(q => q.sql.includes("INSERT INTO organization_membership_roles")));
  assert.ok(state.queries.some(q => q.sql === "COMMIT"));
  assert.equal(state.released, true);
});

test("audit failure rolls back role grant", async () => {
  const { pool, state } = createPool({ failAt: "INSERT INTO identity_audit_events" });
  const result = await manageMembershipRole({ pool, ...base, action: "grant" });
  assert.equal(result.status, 500);
  assert.ok(state.queries.some(q => q.sql === "ROLLBACK"));
  assert.equal(state.committed, false);
});
