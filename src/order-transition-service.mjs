import { createHash } from "node:crypto";
import { evaluateOrderTransition } from "./order-lifecycle.mjs";

const fail = (status, code, message) => ({ status, body: { code, message } });

export async function transitionOrder({
  pool, actor, organizationId, orderId, action, reason = null, idempotencyKey, correlationId
}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A database pool is required");
  if (!actor?.id || actor.organizationId !== organizationId) return fail(403, "FORBIDDEN", "A verified actor and organization scope are required");
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key between 8 and 200 characters");
  }
  const requestHash = createHash("sha256").update(JSON.stringify({
    action, orderId: String(orderId).toLowerCase(), reason: typeof reason === "string" ? reason.trim() : null
  })).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reserved = await client.query(
      `INSERT INTO order_idempotency_keys (organization_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [organizationId, idempotencyKey, requestHash]
    );
    if (reserved.rowCount === 0) {
      const previous = await client.query(
        `SELECT request_hash, response_status, response_body
         FROM order_idempotency_keys
         WHERE organization_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
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

    const selected = await client.query(
      `SELECT id, organization_id AS "organizationId", status, created_by AS "createdBy"
       FROM orders
       WHERE organization_id = $1 AND id = $2
       FOR UPDATE`,
      [organizationId, orderId]
    );
    if (selected.rowCount !== 1) {
      await client.query("ROLLBACK");
      return fail(404, "ORDER_NOT_FOUND", "Order was not found in this organization");
    }
    const decision = evaluateOrderTransition({
      order: selected.rows[0],
      actor,
      action,
      reason
    });
    if (!decision.allowed) {
      await client.query("ROLLBACK");
      const status = decision.code === "FORBIDDEN" ? 403 :
        decision.code === "ORDER_NOT_FOUND" ? 404 :
        decision.code === "REASON_REQUIRED" ? 422 : 409;
      return fail(status, decision.code, decision.message);
    }

    const updated = await client.query(
      `UPDATE orders
       SET status = $4, updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = $3
       RETURNING id, status, order_number AS "orderNumber", updated_at AS "updatedAt"`,
      [organizationId, orderId, decision.from, decision.to]
    );
    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return fail(409, "CONCURRENT_MODIFICATION", "Order state changed during the transition");
    }

    const auditDecision = action === "approve" ? "approved" : action === "reject" ? "rejected" : "allowed";
    await client.query(
      `INSERT INTO audit_events
         (organization_id, correlation_id, actor_id, subject_type, subject_id, action, decision,
          previous_state, next_state, reason, evidence_refs)
       VALUES ($1, $2, $3, 'order', $4, $5, $6, $7, $8, $9, '[]'::jsonb)`,
      [organizationId, correlationId, actor.id, orderId, `order.${action}`, auditDecision, decision.from, decision.to, decision.reason]
    );

    const responseBody = {
      item: { ...updated.rows[0], previousStatus: decision.from, action },
      correlationId
    };
    await client.query(
      `UPDATE order_idempotency_keys
       SET response_status = 200, response_body = $3::jsonb, completed_at = now()
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [organizationId, idempotencyKey, JSON.stringify(responseBody)]
    );
    await client.query("COMMIT");
    return { status: 200, body: responseBody };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return fail(409, "CONFLICT", "The requested transition conflicts with current data");
    return fail(500, "INTERNAL_ERROR", "Order transition could not be completed");
  } finally {
    client.release();
  }
}
