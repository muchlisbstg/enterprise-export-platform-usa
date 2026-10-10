import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

test("identity audit ledger enforces request idempotency and constrained decisions", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  let orgId;
  let actorId;
  let targetId;
  const requestKey = "identity-audit-" + suffix;
  try {
    orgId = (await pool.query(
      "INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id",
      ["Identity Audit Tenant " + suffix, "identity-audit-" + suffix]
    )).rows[0].id;
    actorId = (await pool.query(
      "INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, $2) RETURNING id",
      ["https://identity-audit.example/" + suffix, "actor-" + suffix]
    )).rows[0].id;
    targetId = (await pool.query(
      "INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, $2) RETURNING id",
      ["https://identity-audit.example/" + suffix, "target-" + suffix]
    )).rows[0].id;

    const event = await pool.query(
      `INSERT INTO identity_audit_events
        (organization_id, correlation_id, request_key, actor_user_id, target_user_id, action, decision, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, 'role.grant', 'allowed', $6, $7::jsonb)
       RETURNING id, action, decision, metadata`,
      [orgId, randomUUID(), requestKey, actorId, targetId, "Approved access request " + suffix, JSON.stringify({ ticketRef: "SEC-" + suffix })]
    );
    assert.equal(event.rowCount, 1);
    assert.equal(event.rows[0].action, "role.grant");
    assert.equal(event.rows[0].decision, "allowed");
    assert.deepEqual(event.rows[0].metadata, { ticketRef: "SEC-" + suffix });

    await assert.rejects(
      pool.query(
        `INSERT INTO identity_audit_events
          (organization_id, correlation_id, request_key, actor_user_id, target_user_id, action, decision)
         VALUES ($1, $2, $3, $4, $5, 'role.grant', 'allowed')`,
        [orgId, randomUUID(), requestKey, actorId, targetId]
      ),
      error => error.code === "23505"
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO identity_audit_events
          (organization_id, correlation_id, request_key, actor_user_id, target_user_id, action, decision)
         VALUES ($1, $2, $3, $4, $5, 'role.grant', 'approved')`,
        [orgId, randomUUID(), "bad-decision-" + suffix, actorId, targetId]
      ),
      error => error.code === "23514"
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO identity_audit_events
          (organization_id, correlation_id, request_key, actor_user_id, target_user_id, action, decision, metadata)
         VALUES ($1, $2, $3, $4, $5, 'role.grant', 'denied', '[]'::jsonb)`,
        [orgId, randomUUID(), "bad-metadata-" + suffix, actorId, targetId]
      ),
      error => error.code === "23514"
    );
  } finally {
    if (orgId) await pool.query("DELETE FROM identity_audit_events WHERE organization_id = $1", [orgId]);
    if (actorId || targetId) await pool.query("DELETE FROM identity_audit_events WHERE actor_user_id = $1 OR target_user_id = $1", [actorId ?? targetId]);
    if (actorId && targetId) await pool.query("DELETE FROM identity_audit_events WHERE actor_user_id = $1 OR target_user_id = $1", [targetId]);
    if (actorId) await pool.query("DELETE FROM app_users WHERE id = $1", [actorId]);
    if (targetId) await pool.query("DELETE FROM app_users WHERE id = $1", [targetId]);
    if (orgId) await pool.query("DELETE FROM organizations WHERE id = $1", [orgId]);
    await pool.end();
  }
});
