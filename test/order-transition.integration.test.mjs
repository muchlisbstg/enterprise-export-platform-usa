import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createHandler } from "../src/app.mjs";
import { resolveOrganizationPrincipal } from "../src/authorization.mjs";

const databaseUrl = process.env.DATABASE_URL;
test("order transitions enforce tenant roles, state, idempotency, and audit atomically", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const issuer = "https://transition-test.example/" + suffix;
  const org = (await pool.query("INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id", ["Transition Tenant " + suffix, "transition-" + suffix])).rows[0].id;
  const creatorId = (await pool.query("INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, 'creator') RETURNING id", [issuer])).rows[0].id;
  const approverId = (await pool.query("INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, 'approver') RETURNING id", [issuer])).rows[0].id;
  let server;
  try {
    for (const userId of [creatorId, approverId]) {
      await pool.query("INSERT INTO organization_memberships (organization_id, user_id, status) VALUES ($1, $2, 'active')", [org, userId]);
    }
    await pool.query("INSERT INTO organization_membership_roles (organization_id, user_id, role_key) VALUES ($1, $2, 'order-creator'), ($1, $2, 'order-submitter')", [org, creatorId]);
    await pool.query("INSERT INTO organization_membership_roles (organization_id, user_id, role_key) VALUES ($1, $2, 'order-approver')", [org, approverId]);
    const customerId = (await pool.query("INSERT INTO parties (organization_id, kind, legal_name, country_code) VALUES ($1, 'customer', $2, 'US') RETURNING id", [org, "Customer " + suffix])).rows[0].id;
    const productId = (await pool.query("INSERT INTO products (organization_id, sku, name, unit_of_measure) VALUES ($1, $2, $3, 'each') RETURNING id", [org, "SKU-" + suffix, "Product " + suffix])).rows[0].id;

    server = createServer(createHandler({
      pool,
      authenticate: async req => {
        if (req.headers.authorization === "Bearer creator-token") return { issuer, subject: "creator" };
        if (req.headers.authorization === "Bearer approver-token") return { issuer, subject: "approver" };
        return null;
      },
      resolvePrincipal: resolveOrganizationPrincipal
    }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    const headers = { authorization: "Bearer creator-token", "x-organization-id": org, "content-type": "application/json" };
    const created = await fetch(base + "/api/v1/orders", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "create-" + suffix },
      body: JSON.stringify({ customerPartyId: customerId, orderNumber: "ORD-" + suffix, currency: "USD", lines: [{ productId, quantity: 1, unitPrice: 2 }] })
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    const orderId = createdBody.item.id;

    const submitHeaders = { ...headers, "idempotency-key": "submit-" + suffix };
    const submitted = await fetch(base + "/api/v1/orders/" + orderId + "/submit", { method: "POST", headers: submitHeaders });
    assert.equal(submitted.status, 200);
    assert.equal((await submitted.json()).item.status, "submitted");
    const replay = await fetch(base + "/api/v1/orders/" + orderId + "/submit", { method: "POST", headers: submitHeaders });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotency-replayed"), "true");

    const selfApprove = await fetch(base + "/api/v1/orders/" + orderId + "/approve", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "self-approve-" + suffix }
    });
    assert.equal(selfApprove.status, 403);

    const approved = await fetch(base + "/api/v1/orders/" + orderId + "/approve", {
      method: "POST",
      headers: { authorization: "Bearer approver-token", "x-organization-id": org, "idempotency-key": "approve-" + suffix }
    });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).item.status, "approved");

    const audit = await pool.query(
      "SELECT action, previous_state, next_state, actor_id FROM audit_events WHERE organization_id = $1 AND subject_id = $2 AND action IN ('order.submit', 'order.approve') ORDER BY occurred_at",
      [org, orderId]
    );
    assert.equal(audit.rowCount, 2);
    assert.deepEqual(audit.rows.map(row => [row.previous_state, row.next_state]), [["draft", "submitted"], ["submitted", "approved"]]);
    assert.equal(audit.rows[0].actor_id, creatorId);
    assert.equal(audit.rows[1].actor_id, approverId);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.query("DELETE FROM order_idempotency_keys WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM order_lines WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM orders WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM products WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM parties WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM organization_membership_roles WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [org]);
    await pool.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [[creatorId, approverId]]);
    await pool.query("DELETE FROM organizations WHERE id = $1", [org]);
    await pool.end();
  }
});
