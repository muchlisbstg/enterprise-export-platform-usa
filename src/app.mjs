import { createHash, randomUUID } from "node:crypto";

const allowedOrderStatuses = new Set([
  "draft", "submitted", "approved", "rejected", "cancelled", "fulfilled"
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function parseLimit(raw) {
  if (raw === null) return 25;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 && value <= 100 ? value : null;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("BODY_TOO_LARGE");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("INVALID_JSON");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function validateOrder(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body must be a JSON object";
  if (typeof body.customerPartyId !== "string" || !UUID_RE.test(body.customerPartyId)) return "customerPartyId must be a UUID";
  if (typeof body.orderNumber !== "string" || body.orderNumber.trim().length < 1 || body.orderNumber.trim().length > 80) return "orderNumber must contain 1 to 80 characters";
  if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) return "currency must be a three-letter uppercase code";
  if (body.notes !== undefined && body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 2000)) return "notes must be at most 2000 characters";
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) return "lines must contain between 1 and 100 items";
  for (const [index, line] of body.lines.entries()) {
    if (!line || typeof line !== "object" || Array.isArray(line)) return `lines[${index}] must be an object`;
    if (typeof line.productId !== "string" || !UUID_RE.test(line.productId)) return `lines[${index}].productId must be a UUID`;
    if (typeof line.quantity !== "number" || !Number.isFinite(line.quantity) || line.quantity <= 0 || !/^\d+(\.\d{1,4})?$/.test(String(line.quantity))) return `lines[${index}].quantity must be positive with at most 4 decimal places`;
    if (typeof line.unitPrice !== "number" || !Number.isFinite(line.unitPrice) || line.unitPrice < 0 || !/^\d+(\.\d{1,4})?$/.test(String(line.unitPrice))) return `lines[${index}].unitPrice must be non-negative with at most 4 decimal places`;
  }
  return null;
}

function orderRequestHash(body) {
  const canonical = {
    customerPartyId: body.customerPartyId.toLowerCase(),
    orderNumber: body.orderNumber.trim(),
    currency: body.currency,
    notes: body.notes ?? null,
    lines: body.lines.map(line => ({
      productId: line.productId.toLowerCase(),
      quantity: line.quantity,
      unitPrice: line.unitPrice
    }))
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
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

      if (req.method === "POST" && url.pathname === "/api/v1/orders") {
        const contentType = req.headers["content-type"] ?? "";
        if (!contentType.toLowerCase().startsWith("application/json")) {
          return sendJson(res, 415, { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json", correlationId });
        }

        const idempotencyKey = req.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
          return sendJson(res, 400, { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Provide an Idempotency-Key between 8 and 200 characters", correlationId });
        }

        let body;
        try {
          body = await readJson(req);
        } catch (error) {
          const tooLarge = error.code === "BODY_TOO_LARGE";
          return sendJson(res, tooLarge ? 413 : 400, {
            code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_JSON",
            message: tooLarge ? "Request body exceeds 64 KiB" : "Request body must be valid JSON",
            correlationId
          });
        }

        const validationError = validateOrder(body);
        if (validationError) return sendJson(res, 400, { code: "VALIDATION_ERROR", message: validationError, correlationId });
        const requestHash = orderRequestHash(body);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const reservation = await client.query(
            `INSERT INTO order_idempotency_keys (organization_id, idempotency_key, request_hash)
             VALUES ($1, $2, $3)
             ON CONFLICT (organization_id, idempotency_key) DO NOTHING
             RETURNING idempotency_key`,
            [organizationId, idempotencyKey, requestHash]
          );

          if (reservation.rowCount === 0) {
            const previous = await client.query(
              `SELECT request_hash, response_status, response_body
               FROM order_idempotency_keys
               WHERE organization_id = $1 AND idempotency_key = $2
               FOR UPDATE`,
              [organizationId, idempotencyKey]
            );
            const record = previous.rows[0];
            if (!record || record.request_hash !== requestHash) {
              await client.query("ROLLBACK");
              return sendJson(res, 409, { code: "IDEMPOTENCY_CONFLICT", message: "This key was already used for a different request", correlationId });
            }
            if (record.response_status === null || record.response_body === null) {
              await client.query("ROLLBACK");
              return sendJson(res, 409, { code: "IDEMPOTENCY_IN_PROGRESS", message: "A request with this key is still in progress", correlationId });
            }
            await client.query("COMMIT");
            return sendJson(res, record.response_status, record.response_body, { "idempotency-replayed": "true" });
          }

          const customer = await client.query(
            `SELECT id FROM parties
             WHERE organization_id = $1 AND id = $2 AND active = true AND kind IN ('customer', 'both')`,
            [organizationId, body.customerPartyId]
          );
          if (customer.rowCount !== 1) {
            await client.query("ROLLBACK");
            return sendJson(res, 422, { code: "INVALID_CUSTOMER", message: "Customer is not active or does not belong to this organization", correlationId });
          }

          const productIds = [...new Set(body.lines.map(line => line.productId))];
          const products = await client.query(
            `SELECT id FROM products
             WHERE organization_id = $1 AND active = true AND id = ANY($2::uuid[])`,
            [organizationId, productIds]
          );
          if (products.rowCount !== productIds.length) {
            await client.query("ROLLBACK");
            return sendJson(res, 422, { code: "INVALID_PRODUCT", message: "One or more products are inactive or do not belong to this organization", correlationId });
          }

          const inserted = await client.query(
            `INSERT INTO orders (organization_id, customer_party_id, order_number, status, currency, notes)
             VALUES ($1, $2, $3, 'draft', $4, $5)
             RETURNING id, status, order_number AS "orderNumber", customer_party_id AS "customerPartyId", currency, notes, created_at AS "createdAt"`,
            [organizationId, body.customerPartyId, body.orderNumber.trim(), body.currency, body.notes ?? null]
          );
          const order = inserted.rows[0];
          const lines = [];
          for (const [index, line] of body.lines.entries()) {
            const result = await client.query(
              `INSERT INTO order_lines (organization_id, order_id, line_number, product_id, quantity, unit_price)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING product_id AS "productId", quantity::text AS quantity, unit_price::text AS "unitPrice", line_number AS "lineNumber"`,
              [organizationId, order.id, index + 1, line.productId, line.quantity, line.unitPrice]
            );
            lines.push(result.rows[0]);
          }

          await client.query(
            `INSERT INTO audit_events (organization_id, correlation_id, subject_type, subject_id, action, decision, evidence_refs)
             VALUES ($1, $2, 'order', $3, 'order.created', 'allowed', '[]'::jsonb)`,
            [organizationId, correlationId, order.id]
          );
          const responseBody = { item: { ...order, lines }, correlationId };
          await client.query(
            `UPDATE order_idempotency_keys
             SET response_status = 201, response_body = $3::jsonb, completed_at = now()
             WHERE organization_id = $1 AND idempotency_key = $2`,
            [organizationId, idempotencyKey, JSON.stringify(responseBody)]
          );
          await client.query("COMMIT");
          return sendJson(res, 201, responseBody, { location: `/api/v1/orders/${order.id}` });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          if (error.code === "23505") {
            return sendJson(res, 409, { code: "ORDER_NUMBER_CONFLICT", message: "An order with this order number already exists", correlationId });
          }
          return sendJson(res, 500, { code: "INTERNAL_ERROR", message: "Request could not be completed", correlationId });
        } finally {
          client.release();
        }
      }

      return sendJson(res, 404, { code: "NOT_FOUND", message: "Route not found", correlationId });
    } catch {
      return sendJson(res, 500, { code: "INTERNAL_ERROR", message: "Request could not be completed", correlationId });
    }
  };
}
