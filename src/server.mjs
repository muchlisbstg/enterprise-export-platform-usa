import { createServer } from "node:http";
import pg from "pg";
import { createHandler } from "./app.mjs";

const { Pool } = pg;
const port = Number(process.env.PORT ?? 8080);
const databaseUrl = process.env.DATABASE_URL;
const token = process.env.API_BEARER_TOKEN;
const organizationId = process.env.DEFAULT_ORGANIZATION_ID;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!token || token.length < 24) throw new Error("Set API_BEARER_TOKEN to a secret of at least 24 characters");
if (!organizationId) throw new Error("DEFAULT_ORGANIZATION_ID is required");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: "enterprise-export-platform-api"
});

const server = createServer(createHandler({ pool, token, organizationId }));
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
