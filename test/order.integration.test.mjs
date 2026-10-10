import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createHandler } from "../src/app.mjs";

const databaseUrl = process.env.DATABASE_URL;
const TOKEN = "integration-test-token-long-enough-for-local-ci";
const enabled = Boolean(databaseUrl);

test("PostgreSQL order creation is tenant-scoped and idempotent", { skip: !enabled }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  let orgA;
  let orgB;
  let customerA;
  let productA;
  let productB;
  let server;

  try {
    const a = await pool.query(
      "INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id",
      ["Integration Tenant A " + suffix, "integration-a-" + suffix]
    );
    orgA = a.rows[0].id;
    const b = await pool.query(
      "INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id",
      ["Integration Tenant B " + suffix, "integration-b-" + suffix]
    );
    orgB = b.rows[0].id;

    customerA = (await pool.query(
      "INSERT INTO parties (organization_id, kind, legal_name, country_code) VALUES ($1, 'customer', $2, 'US') RETURNING id",
      [orgA, "Customer A " + suffix]
    )).rows[0].id;
    productA = (await pool.query(
      "INSERT INTO products (organization_id, sku, name, unit_of_measure) VALUES ($1, $2, $3, 'each') RETURNING id",
      [orgA, "SKU-A-" + suffix, "Product A " + suffix]
    )).rows[0].id;
    productB = (await pool.query(
      "INSERT INTO products (organization_id, sku, name, unit_of_measure) VALUES ($1, $2, $3, 'each') RETURNING id",
      [orgB, "SKU-B-" + suffix, "Product B " + suffix]
    )).rows[0].id;

    server = createServer(createHandler({ pool, token: TOKEN, organizationId: orgA }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const base = "http://127.0.0.1:" + address.port;
    const headers = {
      authorization: "Bearer " + TOKEN,
      "content-type": "application/json",
      "idempotency-key": "integration-" + suffix
    };
    const body = {
      customerPartyId: customerA,
      orderNumber: "ORDER-" + suffix,
      currency: "USD",
      notes: "synthetic integration fixture",
      lines: [{ productId: productA, quantity: 2, unitPrice: 12.5 }]
    };

    const first = await fetch(base + "/api/v1/orders", {
      method: "POST", headers, body: JSON.stringify(body)
    });
    const firstBody = await first.json();
    assert.equal(first.status, 201);
    assert.equal(firstBody.item.status, "draft");
    assert.equal(firstBody.item.lines.length, 1);

    const replay = await fetch(base + "/api/v1/orders", {
      method: "POST", headers, body: JSON.stringify(body)
    });
    const replayBody = await replay.json();
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get("idempotency-replayed"), "true");
    assert.equal(replayBody.item.id, firstBody.item.id);

    const conflict = await fetch(base + "/api/v1/orders", {
      method: "POST", headers, body: JSON.stringify({ ...body, notes: "changed payload" })
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "IDEMPOTENCY_CONFLICT");

    const crossTenantProduct = await fetch(base + "/api/v1/orders", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "tenant-check-" + suffix },
      body: JSON.stringify({
        ...body,
        orderNumber: "CROSS-TENANT-" + suffix,
        lines: [{ productId: productB, quantity: 1, unitPrice: 1 }]
      })
    });
    assert.equal(crossTenantProduct.status, 422);
    assert.equal((await crossTenantProduct.json()).code, "INVALID_PRODUCT");

    const duplicateOrderNumber = await fetch(base + "/api/v1/orders", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "duplicate-" + suffix },
      body: JSON.stringify(body)
    });
    assert.equal(duplicateOrderNumber.status, 409);
    assert.equal((await duplicateOrderNumber.json()).code, "ORDER_NUMBER_CONFLICT");

    const counts = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM orders WHERE organization_id = $1 AND order_number = $2) AS orders,
        (SELECT count(*)::int FROM order_lines WHERE organization_id = $1 AND order_id = $3) AS lines,
        (SELECT count(*)::int FROM audit_events WHERE organization_id = $1 AND subject_id = $3 AND action = 'order.created') AS audit_events,
        (SELECT count(*)::int FROM order_idempotency_keys WHERE organization_id = $1 AND idempotency_key = $4) AS idempotency_records`,
      [orgA, body.orderNumber, firstBody.item.id, headers["idempotency-key"]]
    );
    assert.deepEqual(counts.rows[0], { orders: 1, lines: 1, audit_events: 1, idempotency_records: 1 });
  } finally {
    if (server) await new Promise(resolve => server.close(error => error ? reject(error) : resolve()));
    if (orgA) {
      await pool.query("DELETE FROM order_idempotency_keys WHERE organization_id = $1", [orgA]);
      await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [orgA]);
      await pool.query("DELETE FROM order_lines WHERE organization_id = $1", [orgA]);
      await pool.query("DELETE FROM orders WHERE organization_id = $1", [orgA]);
      await pool.query("DELETE FROM products WHERE organization_id = $1", [orgA]);
      await pool.query("DELETE FROM parties WHERE organization_id = $1", [orgA]);
    }
    if (orgB) {
      await pool.query("DELETE FROM products WHERE organization_id = $1", [orgB]);
      await pool.query("DELETE FROM parties WHERE organization_id = $1", [orgB]);
    }
    if (orgA) await pool.query("DELETE FROM organizations WHERE id = $1", [orgA]);
    if (orgB) await pool.query("DELETE FROM organizations WHERE id = $1", [orgB]);
    await pool.end();
  }
});
