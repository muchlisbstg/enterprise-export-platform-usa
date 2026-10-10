import { randomUUID } from "node:crypto";

const allowedOrderStatuses = new Set([
  "draft", "submitted", "approved", "rejected", "cancelled", "fulfilled"
]);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function parseLimit(raw) {
  if (raw === null) return 25;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 && value <= 100 ? value : null;
}

export function createHandler({ pool, token, organizationId }) {
  if (!pool || typeof pool.query !== "function") throw new Error("A database pool is required");
  if (!token || token.length < 24) throw new Error("API_BEARER_TOKEN must contain at least 24 characters");
  if (!organizationId) throw new Error("DEFAULT_ORGANIZATION_ID is required");

  return async function handler(req, res) {
    const correlationId = randomUUID();
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", service: "enterprise-export-platform-api" });
    }

    if (!url.pathname.startsWith("/api/v1/")) {
      return sendJson(res, 404, { code: "NOT_FOUND", message: "Route not found", correlationId });
    }

    const authorization = req.headers.authorization ?? "";
    if (authorization !== `Bearer ${token}`) {
      return sendJson(res, 401, { code: "UNAUTHORIZED", message: "Missing or invalid bearer token", correlationId });
    }

    const limit = parseLimit(url.searchParams.get("limit"));
    if (limit === null) {
      return sendJson(res, 400, { code: "INVALID_LIMIT", message: "limit must be an integer from 1 to 100", correlationId });
    }

    try {
      if (req.method === "GET" && url.pathname === "/api/v1/products") {
        const result = await pool.query(
          `SELECT id, sku, name, description, unit_of_measure AS "unitOfMeasure", active
           FROM products
           WHERE organization_id = $1 AND active = true
           ORDER BY name, id
           LIMIT $2`,
          [organizationId, limit]
        );
        return sendJson(res, 200, { items: result.rows, nextCursor: null });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/parties") {
        const kind = url.searchParams.get("kind");
        if (kind && !["customer", "supplier", "both"].includes(kind)) {
          return sendJson(res, 400, { code: "INVALID_KIND", message: "kind must be customer, supplier, or both", correlationId });
        }
        const result = await pool.query(
          `SELECT id, kind, legal_name AS "legalName", country_code AS "countryCode", active
           FROM parties
           WHERE organization_id = $1 AND active = true
             AND ($2::text IS NULL OR kind = $2 OR kind = 'both')
           ORDER BY legal_name, id
           LIMIT $3`,
          [organizationId, kind, limit]
        );
        return sendJson(res, 200, { items: result.rows, nextCursor: null });
      }

      if (req.method === "GET" && url.pathname === "/api/v1/orders") {
        const status = url.searchParams.get("status");
        if (status && !allowedOrderStatuses.has(status)) {
          return sendJson(res, 400, { code: "INVALID_STATUS", message: "Unsupported order status", correlationId });
        }
        const result = await pool.query(
          `SELECT o.id, o.status, o.currency, o.notes, o.order_number AS "orderNumber",
                  o.customer_party_id AS "customerPartyId",
                  COALESCE(jsonb_agg(jsonb_build_object(
                    'productId', ol.product_id,
                    'quantity', ol.quantity,
                    'unitPrice', ol.unit_price
                  ) ORDER BY ol.line_number) FILTER (WHERE ol.id IS NOT NULL), '[]'::jsonb) AS lines
           FROM orders o
           LEFT JOIN order_lines ol
             ON ol.organization_id = o.organization_id AND ol.order_id = o.id
           WHERE o.organization_id = $1 AND ($2::text IS NULL OR o.status = $2)
           GROUP BY o.id
           ORDER BY o.created_at DESC, o.id
           LIMIT $3`,
          [organizationId, status, limit]
        );
        return sendJson(res, 200, { items: result.rows, nextCursor: null });
      }

      return sendJson(res, 404, { code: "NOT_FOUND", message: "Route not found", correlationId });
    } catch {
      return sendJson(res, 500, { code: "INTERNAL_ERROR", message: "Request could not be completed", correlationId });
    }
  };
}
