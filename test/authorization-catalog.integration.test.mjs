import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
test("authorization catalog seeds role templates without granting memberships", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const roles = await pool.query(
      "SELECT role_key, managed_by FROM authorization_roles WHERE role_key = ANY($1::text[]) ORDER BY role_key",
      [["export-reader", "order-creator", "order-submitter", "order-approver", "order-canceller", "order-fulfiller"]]
    );
    assert.equal(roles.rowCount, 6);
    assert.ok(roles.rows.every(row => row.managed_by === "system"));

    const permissions = await pool.query(
      "SELECT permission_key FROM authorization_permissions WHERE permission_key = ANY($1::text[])",
      [["products:read", "parties:read", "orders:read", "orders:create", "order:submit", "order:approve", "order:reject", "order:cancel", "order:fulfil"]]
    );
    assert.equal(permissions.rowCount, 9);

    const approver = await pool.query(
      "SELECT permission_key FROM authorization_role_permissions WHERE role_key = 'order-approver' ORDER BY permission_key"
    );
    assert.deepEqual(approver.rows.map(row => row.permission_key), ["order:approve", "order:reject", "orders:read"]);
  } finally {
    await pool.end();
  }
});
