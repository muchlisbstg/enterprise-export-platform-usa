import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHandler } from "../src/app.mjs";

const TOKEN = "local-development-token-that-is-long-enough";
const ORG = "00000000-0000-4000-8000-000000000001";

async function withServer(pool, run) {
  const server = createServer(createHandler({ pool, token: TOKEN, organizationId: ORG }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("health is public and does not query the database", async () => {
  const pool = { query: async () => { throw new Error("should not query"); } };
  await withServer(pool, async base => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  });
});

test("protected endpoints reject requests without a bearer token", async () => {
  const pool = { query: async () => { throw new Error("should not query"); } };
  await withServer(pool, async base => {
    const response = await fetch(`${base}/api/v1/products`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "UNAUTHORIZED");
  });
});

test("product query is scoped to the configured organization and parameterized", async () => {
  let observed;
  const pool = { query: async (sql, params) => {
    observed = { sql, params };
    return { rows: [{ id: "p1", sku: "SKU-1", name: "Part", unitOfMeasure: "each", active: true }] };
  }};
  await withServer(pool, async base => {
    const response = await fetch(`${base}/api/v1/products?limit=10`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].sku, "SKU-1");
    assert.match(observed.sql, /organization_id = \$1/);
    assert.deepEqual(observed.params, [ORG, 10]);
  });
});

test("invalid limit is rejected before a database query", async () => {
  const pool = { query: async () => { throw new Error("should not query"); } };
  await withServer(pool, async base => {
    const response = await fetch(`${base}/api/v1/orders?limit=101`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_LIMIT");
  });
});

test("database errors return a safe error response", async () => {
  const pool = { query: async () => { throw new Error("sensitive database detail"); } };
  await withServer(pool, async base => {
    const response = await fetch(`${base}/api/v1/products`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.doesNotMatch(body, /sensitive database detail/);
  });
});

test("order creation requires an idempotency key", async () => {
  const pool = { query: async () => { throw new Error("should not query"); }, connect: async () => { throw new Error("should not connect"); } };
  await withServer(pool, async base => {
    const response = await fetch(base + "/api/v1/orders", { method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "IDEMPOTENCY_KEY_REQUIRED");
  });
});

test("order creation rejects unsupported media types", async () => {
  const pool = { query: async () => { throw new Error("should not query"); }, connect: async () => { throw new Error("should not connect"); } };
  await withServer(pool, async base => {
    const response = await fetch(base + "/api/v1/orders", { method: "POST", headers: { authorization: "Bearer " + TOKEN, "idempotency-key": "test-key-0001", "content-type": "text/plain" }, body: "{}" });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).code, "UNSUPPORTED_MEDIA_TYPE");
  });
});

test("order creation validates lines before opening a transaction", async () => {
  const pool = { query: async () => { throw new Error("should not query"); }, connect: async () => { throw new Error("should not connect"); } };
  await withServer(pool, async base => {
    const response = await fetch(base + "/api/v1/orders", { method: "POST", headers: { authorization: "Bearer " + TOKEN, "idempotency-key": "test-key-0002", "content-type": "application/json" }, body: JSON.stringify({ customerPartyId: "00000000-0000-4000-8000-000000000001", orderNumber: "ORD-TEST", currency: "USD", lines: [] }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "VALIDATION_ERROR");
  });
});


const ACTOR = "00000000-0000-4000-8000-000000000002";
const TARGET = "00000000-0000-4000-8000-000000000003";

async function withOidcServer(pool, principal, run) {
  const server = createServer(createHandler({
    pool,
    authenticate: async () => ({ issuer: "https://issuer.example", subject: "verified-subject" }),
    resolvePrincipal: async () => principal
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("membership role administration rejects legacy shared-token callers without a verified user", async () => {
  const pool = {
    query: async () => { throw new Error("should not query"); },
    connect: async () => { throw new Error("should not connect"); }
  };
  await withServer(pool, async base => {
    const response = await fetch(base + `/api/v1/memberships/${TARGET}/roles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "role-grant-test-01"
      },
      body: JSON.stringify({ action: "grant", roleKey: "order-creator" })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FORBIDDEN");
  });
});

test("membership role administration derives permissions from the resolved principal", async () => {
  const pool = {
    query: async () => { throw new Error("should not query"); },
    connect: async () => { throw new Error("permission denial must happen before transaction"); }
  };
  await withOidcServer(pool, {
    userId: ACTOR,
    organizationId: ORG,
    permissions: ["orders:read"]
  }, async base => {
    const response = await fetch(base + `/api/v1/memberships/${TARGET}/roles`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-token",
        "x-organization-id": ORG,
        "content-type": "application/json",
        "idempotency-key": "role-grant-test-02"
      },
      body: JSON.stringify({ action: "grant", roleKey: "order-creator" })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FORBIDDEN");
  });
});
