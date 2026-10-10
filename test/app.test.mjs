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
