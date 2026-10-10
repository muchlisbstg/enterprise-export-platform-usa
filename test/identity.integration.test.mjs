import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const enabled = Boolean(databaseUrl);

test("identity schema enforces unique external subjects and tenant-scoped role assignments", { skip: !enabled }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  let orgA;
  let orgB;
  let userId;
  let roleKey;
  let permissionKey;

  try {
    orgA = (await pool.query(
      "INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id",
      ["Identity Tenant A " + suffix, "identity-a-" + suffix]
    )).rows[0].id;
    orgB = (await pool.query(
      "INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id",
      ["Identity Tenant B " + suffix, "identity-b-" + suffix]
    )).rows[0].id;

    userId = (await pool.query(
      "INSERT INTO app_users (identity_issuer, identity_subject, email) VALUES ($1, $2, $3) RETURNING id",
      ["https://issuer.example.test/" + suffix, "subject-" + suffix, "test-" + suffix + "@example.test"]
    )).rows[0].id;

    await pool.query(
      "INSERT INTO organization_memberships (organization_id, user_id, status) VALUES ($1, $2, 'active')",
      [orgA, userId]
    );

    await assert.rejects(
      pool.query(
        "INSERT INTO app_users (identity_issuer, identity_subject) VALUES ($1, $2)",
        ["https://issuer.example.test/" + suffix, "subject-" + suffix]
      ),
      error => error.code === "23505"
    );

    await assert.rejects(
      pool.query(
        "INSERT INTO organization_memberships (organization_id, user_id, status) VALUES ($1, $2, 'active')",
        [orgB, randomUUID()]
      ),
      error => error.code === "23503"
    );

    roleKey = "test-role-" + suffix;
    permissionKey = "test-permission-" + suffix;
    await pool.query(
      "INSERT INTO authorization_roles (role_key, description) VALUES ($1, $2)",
      [roleKey, "Integration test role"]
    );
    await pool.query(
      "INSERT INTO authorization_permissions (permission_key, description) VALUES ($1, $2)",
      [permissionKey, "Integration test permission"]
    );
    await pool.query(
      "INSERT INTO authorization_role_permissions (role_key, permission_key) VALUES ($1, $2)",
      [roleKey, permissionKey]
    );
    await pool.query(
      "INSERT INTO organization_membership_roles (organization_id, user_id, role_key) VALUES ($1, $2, $3)",
      [orgA, userId, roleKey]
    );

    const joined = await pool.query(
      "SELECT m.organization_id, m.status, r.role_key, p.permission_key " +
      "FROM organization_memberships m " +
      "JOIN organization_membership_roles mr ON mr.organization_id = m.organization_id AND mr.user_id = m.user_id " +
      "JOIN authorization_roles r ON r.role_key = mr.role_key " +
      "JOIN authorization_role_permissions rp ON rp.role_key = r.role_key " +
      "JOIN authorization_permissions p ON p.permission_key = rp.permission_key " +
      "WHERE m.organization_id = $1 AND m.user_id = $2",
      [orgA, userId]
    );
    assert.equal(joined.rowCount, 1);
    assert.equal(joined.rows[0].organization_id, orgA);
    assert.equal(joined.rows[0].status, "active");
    assert.equal(joined.rows[0].role_key, roleKey);
    assert.equal(joined.rows[0].permission_key, permissionKey);

    await assert.rejects(
      pool.query(
        "INSERT INTO organization_membership_roles (organization_id, user_id, role_key) VALUES ($1, $2, $3)",
        [orgB, userId, roleKey]
      ),
      error => error.code === "23503"
    );

    await assert.rejects(
      pool.query(
        "INSERT INTO organization_memberships (organization_id, user_id, status) VALUES ($1, $2, 'unknown')",
        [orgA, userId]
      ),
      error => error.code === "23514"
    );
  } finally {
    if (orgA && userId) await pool.query("DELETE FROM organization_membership_roles WHERE organization_id = $1 AND user_id = $2", [orgA, userId]);
    if (roleKey) await pool.query("DELETE FROM authorization_role_permissions WHERE role_key = $1", [roleKey]);
    if (roleKey) await pool.query("DELETE FROM authorization_roles WHERE role_key = $1", [roleKey]);
    if (permissionKey) await pool.query("DELETE FROM authorization_permissions WHERE permission_key = $1", [permissionKey]);
    if (orgA && userId) await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2", [orgA, userId]);
    if (userId) await pool.query("DELETE FROM app_users WHERE id = $1", [userId]);
    if (orgA) await pool.query("DELETE FROM organizations WHERE id = $1", [orgA]);
    if (orgB) await pool.query("DELETE FROM organizations WHERE id = $1", [orgB]);
    await pool.end();
  }
});
