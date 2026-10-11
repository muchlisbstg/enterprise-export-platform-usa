import { createHash } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSIGNABLE_ROLES = new Set([
  "export-reader", "order-creator", "order-submitter",
  "order-approver", "order-canceller", "order-fulfiller"
]);
const fail = (status, code, message) => ({ status, body: { code, message } });

export async function manageMembershipRole({
  pool, actor, organizationId, targetUserId, roleKey, action, idempotencyKey, correlationId
}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A database pool is required");
  if (!actor?.id || actor.organizationId !== organizationId ||
      !UUID_RE.test(actor.id) || !UUID_RE.test(organizationId) || !UUID_RE.test(targetUserId) ||
      typeof correlationId !== "string" || !UUID_RE.test(correlationId)) {
    return fail(403, "FORBIDDEN", "A verified actor and organization scope are required");
  }
  if (!["grant", "revoke"].includes(action)) return fail(400, "INVALID_ACTION", "Action must be grant or revoke");
  const permission = action === "grant" ? "roles:grant" : "roles:revoke";
  if (!Array.isArray(actor.permissions) || !actor.permissions.includes(permission)) {
    return fail(403, "FORBIDDEN", "Required permission is missing");
  }
  if (actor.id === targetUserId) return fail(403, "SELF_ROLE_CHANGE_DENIED", "Self role changes are not permitted");
  if (!ASSIGNABLE_ROLES.has(roleKey)) return fail(400, "ROLE_NOT_ASSIGNABLE", "Role is not in the assignable role catalog");
  // identity_audit_events.request_key has a 160-character database limit.
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 8 || idempotencyKey.length > 160) {
    return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key between 8 and 160 characters");
  }

  const requestHash = createHash("sha256").update(JSON.stringify({ action, targetUserId, roleKey })).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reservation = await client.query(
      `INSERT INTO identity_admin_idempotency_keys (organization_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [organizationId, idempotencyKey, requestHash]
    );
    if (reservation.rowCount === 0) {
      const previous = await client.query(
        `SELECT request_hash, response_status, response_body
         FROM identity_admin_idempotency_keys
         WHERE organization_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [organizationId, idempotencyKey]
      );
      const record = previous.rows[0];
      if (!record || record.request_hash !== requestHash) {
        await client.query("ROLLBACK");
        return fail(409, "IDEMPOTENCY_CONFLICT", "This key was already used for a different request");
      }
      if (record.response_status === null || record.response_body === null) {
        await client.query("ROLLBACK");
        return fail(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this key is still in progress");
      }
      await client.query("COMMIT");
      return { status: record.response_status, body: record.response_body, headers: { "idempotency-replayed": "true" } };
    }

    const target = await client.query(
      `SELECT m.user_id AS "userId", m.status
       FROM organization_memberships m
       JOIN app_users u ON u.id = m.user_id AND u.disabled_at IS NULL
       WHERE m.organization_id = $1 AND m.user_id = $2
       FOR UPDATE OF m`,
      [organizationId, targetUserId]
    );
    if (target.rowCount !== 1 || target.rows[0].status !== "active") {
      await client.query("ROLLBACK");
      return fail(404, "MEMBERSHIP_NOT_FOUND", "Active membership was not found in this organization");
    }
    const role = await client.query(
      `SELECT role_key, managed_by FROM authorization_roles WHERE role_key = $1`,
      [roleKey]
    );
    if (role.rowCount !== 1 || role.rows[0].managed_by !== "system") {
      await client.query("ROLLBACK");
      return fail(400, "ROLE_NOT_ASSIGNABLE", "Role is not in the assignable role catalog");
    }

    let changed;
    if (action === "grant") {
      changed = await client.query(
        `INSERT INTO organization_membership_roles (organization_id, user_id, role_key, granted_by_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, user_id, role_key) DO NOTHING
         RETURNING role_key`,
        [organizationId, targetUserId, roleKey, actor.id]
      );
    } else {
      changed = await client.query(
        `DELETE FROM organization_membership_roles
         WHERE organization_id = $1 AND user_id = $2 AND role_key = $3
         RETURNING role_key`,
        [organizationId, targetUserId, roleKey]
      );
    }

    await client.query(
      `INSERT INTO identity_audit_events
         (organization_id, correlation_id, request_key, actor_user_id, target_user_id, action, decision, role_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'allowed', $7, $8::jsonb)`,
      [organizationId, correlationId, idempotencyKey, actor.id, targetUserId,
        `role.${action}`, roleKey, JSON.stringify({ changed: changed.rowCount === 1 })]
    );
    const body = { item: { organizationId, userId: targetUserId, roleKey, action, changed: changed.rowCount === 1 }, correlationId };
    await client.query(
      `UPDATE identity_admin_idempotency_keys
       SET response_status = 200, response_body = $3::jsonb, completed_at = now()
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [organizationId, idempotencyKey, JSON.stringify(body)]
    );
    await client.query("COMMIT");
    return { status: 200, body };
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return fail(500, "INTERNAL_ERROR", "Role administration could not be completed");
  } finally {
    client.release();
  }
}
