import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrganizationPrincipal } from "../src/authorization.mjs";

test("principal resolution fails closed for incomplete verified claims", async () => {
  const pool = { query: async () => { throw new Error("must not query"); } };
  assert.equal(await resolveOrganizationPrincipal(pool, null, "org"), null);
  assert.equal(await resolveOrganizationPrincipal(pool, { issuer: "issuer" }, "org"), null);
});

test("principal resolution returns only permissions from active organization membership", async () => {
  let observed;
  const pool = { query: async (sql, params) => {
    observed = { sql, params };
    return { rowCount: 1, rows: [{ userId: "user-1", organizationId: "org-1", permissions: ["products:read"] }] };
  }};
  const principal = await resolveOrganizationPrincipal(
    pool,
    { issuer: "https://issuer.example.test", subject: "subject-1" },
    "org-1"
  );
  assert.deepEqual(observed.params, ["https://issuer.example.test", "subject-1", "org-1"]);
  assert.match(observed.sql, /m.status = 'active'/);
  assert.match(observed.sql, /u.disabled_at IS NULL/);
  assert.deepEqual(principal, { userId: "user-1", organizationId: "org-1", permissions: ["products:read"] });
});

test("principal resolution denies absent membership", async () => {
  const pool = { query: async () => ({ rowCount: 0, rows: [] }) };
  assert.equal(await resolveOrganizationPrincipal(
    pool,
    { issuer: "https://issuer.example.test", subject: "subject-1" },
    "org-2"
  ), null);
});
