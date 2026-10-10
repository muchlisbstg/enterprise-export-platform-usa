import { createServer } from "node:http";
import pg from "pg";
import { createHandler } from "./app.mjs";
import { createOidcAuthenticator } from "./oidc.mjs";
import { resolveOrganizationPrincipal } from "./authorization.mjs";

const { Pool } = pg;
const port = Number(process.env.PORT ?? 8080);
const databaseUrl = process.env.DATABASE_URL;
const issuer = process.env.OIDC_ISSUER;
const audience = process.env.OIDC_AUDIENCE;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!issuer) throw new Error("OIDC_ISSUER is required; shared bearer-token fallback is disabled");
if (!audience) throw new Error("OIDC_AUDIENCE is required; shared bearer-token fallback is disabled");

const authenticate = await createOidcAuthenticator({ issuer, audience });

const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: "enterprise-export-platform-api"
});

const server = createServer(createHandler({
  pool,
  authenticate,
  resolvePrincipal: resolveOrganizationPrincipal
}));
server.requestTimeout = 10000;
server.headersTimeout = 12000;

server.listen(port, "0.0.0.0", () => {
  console.log(`Enterprise Export Platform API listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
