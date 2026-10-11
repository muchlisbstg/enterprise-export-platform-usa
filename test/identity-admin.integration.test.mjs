import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { manageMembershipRole } from "../src/identity-admin-service.mjs";

const databaseUrl = process.env.DATABASE_URL;
test("identity role administration persists grant/revoke, idempotency, tenant boundaries, and audit atomically", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  let orgA, orgB, actorId, targetId, crossTenantId;
  const correlationId = randomUUID();
  const actor = () => ({ id: actorId, organizationId: orgA, permissions: ["roles:grant", "roles:revoke"] });
  const base = (overrides = {}) => ({
    pool, actor: actor(), organizationId: orgA, targetUserId: targetId,
    roleKey: "order-creator", correlationId, action: "grant",
    idempotencyKey: "identity-admin-" + suffix, ...overrides
  });

  try {
    orgA = (await pool.query(
      "INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id",
      ["Identity Admin A " + suffix, "identity-admin-a-" + suffix]
    )).rows[0].id;
    orgB = (await pool.query(
      "INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id",
      ["Identity Admin B " + suffix, "identity-admin-b-" + suffix]
    )).rows[0].id;
    actorId = (await pool.query(
      "INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, $2) RETURNING id",
      ["https://identity-admin.example/" + suffix, "actor-" + suffix]
    )).rows[0].id;
    targetId = (await pool.query(
      "INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, $2) RETURNING id",
      ["https://identity-admin.example/" + suffix, "target-" + suffix]
    )).rows[0].id;
    crossTenantId = (await pool.query(
      "INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, $2) RETURNING id",
      ["https://identity-admin.example/" + suffix, "cross-tenant-" + suffix]
    )).rows[0].id;
    await pool.query(
      "INSERT INTO organization_memberships (organization_id, user_id, status) VALUES ($1, $2, 'active'), ($1, $3, 'active'), ($4, $5, 'active')",
      [orgA, actorId, targetId, orgB, crossTenantId]
    );

    const granted = await manageMembershipRole(base());
    assert.equal(granted.status, 200);
    assert.equal(granted.body.item.changed, true);
    const assignment = await pool.query(
      "SELECT role_key FROM organization_membership_roles WHERE organization_id = $1 AND user_id = $2 AND role_key = $3",
      [orgA, targetId, "order-creator"]
    );
    assert.equal(assignment.rowCount, 1);

    const replay = await manageMembershipRole(base());
    assert.equal(replay.status, 200);
    assert.equal(replay.headers?.["idempotency-replayed"], "true");
    assert.deepEqual(replay.body, granted.body);

    const conflict = await manageMembershipRole(base({ roleKey: "order-submitter" }));
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");

    const auditAfterReplay = await pool.query(
      "SELECT count(*)::int AS count FROM identity_audit_events WHERE organization_id = $1 AND request_key = $2",
      [orgA, "identity-admin-" + suffix]
    );
    assert.equal(auditAfterReplay.rows[0].count, 1);

    const crossTenant = await manageMembershipRole(base({
      targetUserId: crossTenantId, idempotencyKey: "cross-tenant-" + suffix
    }));
    assert.equal(crossTenant.status, 404);
    assert.equal(crossTenant.body.code, "MEMBERSHIP_NOT_FOUND");

    const selfChange = await manageMembershipRole(base({
      targetUserId: actorId, idempotencyKey: "self-change-" + suffix
    }));
    assert.equal(selfChange.status, 403);
    assert.equal(selfChange.body.code, "SELF_ROLE_CHANGE_DENIED");

    const unauthorized = await manageMembershipRole(base({
      actor: { ...actor(), permissions: [] }, idempotencyKey: "unauthorized-" + suffix
    }));
    assert.equal(unauthorized.status, 403);
    assert.equal(unauthorized.body.code, "FORBIDDEN");

    const revoked = await manageMembershipRole(base({
      action: "revoke", idempotencyKey: "identity-revoke-" + suffix
    }));
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.item.changed, true);
    const afterRevoke = await pool.query(
      "SELECT count(*)::int AS count FROM organization_membership_roles WHERE organization_id = $1 AND user_id = $2 AND role_key = $3",
      [orgA, targetId, "order-creator"]
    );
    assert.equal(afterRevoke.rows[0].count, 0);

    const concurrentKey = "concurrent-" + suffix;
    const concurrentRequest = base({
      roleKey: "order-submitter",
      idempotencyKey: concurrentKey,
      correlationId: randomUUID()
    });
    const concurrentResults = await Promise.all([
      manageMembershipRole(concurrentRequest),
      manageMembershipRole(concurrentRequest)
    ]);
    assert.deepEqual(concurrentResults.map((result) => result.status), [200, 200]);
    assert.equal(concurrentResults.filter((result) => result.headers?.["idempotency-replayed"] === "true").length, 1);
    // Idempotent replays return the original response body, so both responses may report changed=true.
    // Verify response equivalence here; the database audit count below proves only one request was applied.
    assert.deepEqual(concurrentResults[0].body, concurrentResults[1].body);
    const concurrentAudit = await pool.query(
      "SELECT count(*)::int AS count FROM identity_audit_events WHERE organization_id = $1 AND request_key = $2",
      [orgA, concurrentKey]
    );
    assert.equal(concurrentAudit.rows[0].count, 1);

    const auditRows = await pool.query(
      "SELECT action, decision FROM identity_audit_events WHERE organization_id = $1 AND request_key IN ($2, $3) ORDER BY action",
      [orgA, "identity-admin-" + suffix, "identity-revoke-" + suffix]
    );
    assert.deepEqual(auditRows.rows, [
      { action: "role.grant", decision: "allowed" },
      { action: "role.revoke", decision: "allowed" }
    ]);
  } finally {
    if (orgA) await pool.query("DELETE FROM identity_admin_idempotency_keys WHERE organization_id = $1", [orgA]);
    if (orgA) await pool.query("DELETE FROM identity_audit_events WHERE organization_id = $1", [orgA]);
    if (orgA && actorId) await pool.query("DELETE FROM organization_membership_roles WHERE organization_id = $1 AND user_id = $2", [orgA, actorId]);
    if (orgA && targetId) await pool.query("DELETE FROM organization_membership_roles WHERE organization_id = $1 AND user_id = $2", [orgA, targetId]);
    if (orgB && crossTenantId) await pool.query("DELETE FROM organization_membership_roles WHERE organization_id = $1 AND user_id = $2", [orgB, crossTenantId]);
    if (orgA) await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [orgA]);
    if (orgB) await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [orgB]);
    for (const id of [actorId, targetId, crossTenantId]) if (id) await pool.query("DELETE FROM app_users WHERE id = $1", [id]);
    if (orgA) await pool.query("DELETE FROM organizations WHERE id = $1", [orgA]);
    if (orgB) await pool.query("DELETE FROM organizations WHERE id = $1", [orgB]);
    await pool.end();
  }
});
