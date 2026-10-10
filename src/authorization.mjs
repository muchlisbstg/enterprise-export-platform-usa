export async function resolveOrganizationPrincipal(pool, claims, organizationId) {
  if (!pool || typeof pool.query !== "function") throw new Error("A database pool is required");
  if (!claims || typeof claims.issuer !== "string" || typeof claims.subject !== "string" || !organizationId) return null;

  const result = await pool.query(
    `SELECT u.id AS "userId",
            m.organization_id AS "organizationId",
            COALESCE(
              array_agg(DISTINCT p.permission_key)
                FILTER (WHERE p.permission_key IS NOT NULL),
              ARRAY[]::text[]
            ) AS permissions
     FROM app_users u
     JOIN organization_memberships m ON m.user_id = u.id
     LEFT JOIN organization_membership_roles mr
       ON mr.organization_id = m.organization_id AND mr.user_id = m.user_id
     LEFT JOIN authorization_role_permissions rp ON rp.role_key = mr.role_key
     LEFT JOIN authorization_permissions p ON p.permission_key = rp.permission_key
     WHERE u.identity_issuer = $1
       AND u.identity_subject = $2
       AND u.disabled_at IS NULL
       AND m.organization_id = $3
       AND m.status = 'active'
     GROUP BY u.id, m.organization_id
     LIMIT 1`,
    [claims.issuer, claims.subject, organizationId]
  );
  if (result.rowCount !== 1) return null;
  const row = result.rows[0];
  return {
    userId: row.userId,
    organizationId: row.organizationId,
    permissions: Array.isArray(row.permissions) ? row.permissions : []
  };
}
