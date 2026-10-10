import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHandler } from "../src/app.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";

async function runRequest({ permissions, headers = {}, pool = { query: async () => ({ rows: [] }) }, path = "/api/v1/products" }) {
  let resolverCalls = 0;
  const server = createServer(createHandler({
    pool,
    authenticate: async req => req.headers.authorization === "Bearer verified-test-token"
      ? { issuer: "https://issuer.example.test", subject: "subject-1" }
      : null,
    resolvePrincipal: async (_pool, _claims, orgId) => {
      resolverCalls++;
      if (orgId !== ORG) return null;
      return { userId: "user-1", organizationId: orgId, permissions };
    }
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const response = await fetch("http://127.0.0.1:" + address.port + path, {
      headers: { authorization: "Bearer verified-test-token", ...headers }
    });
    return { response, resolverCalls };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("OIDC API mode requires an explicit organization header", async () => {
  const { response, resolverCalls } = await runRequest({ permissions: ["products:read"] });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "ORGANIZATION_REQUIRED");
  assert.equal(resolverCalls, 0);
});

test("OIDC API mode denies requests without the route permission", async () => {
  const { response } = await runRequest({ permissions: ["orders:read"], headers: { "x-organization-id": ORG } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FORBIDDEN");
});

test("OIDC API mode uses the resolved tenant for database queries", async () => {
  let params;
  const pool = { query: async (_sql, values) => { params = values; return { rows: [] }; } };
  const { response } = await runRequest({
    permissions: ["products:read"],
    headers: { "x-organization-id": ORG },
    pool
  });
  assert.equal(response.status, 200);
  assert.deepEqual(params, [ORG, 25]);
});
