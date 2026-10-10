import test from "node:test";
import assert from "node:assert/strict";
import { createOidcAuthenticator } from "../src/oidc.mjs";

const ISSUER = "https://identity.example.test";

function response(body, ok = true) {
  return { ok, json: async () => body };
}

test("OIDC authenticator requires issuer and audience", async () => {
  await assert.rejects(createOidcAuthenticator({ issuer: "", audience: "api" }), /OIDC_ISSUER is required/);
  await assert.rejects(createOidcAuthenticator({ issuer: ISSUER, audience: "" }), /OIDC_AUDIENCE is required/);
});

test("OIDC discovery issuer must exactly match configured issuer", async () => {
  await assert.rejects(
    createOidcAuthenticator({
      issuer: ISSUER,
      audience: "export-api",
      fetchImpl: async () => response({ issuer: "https://attacker.example.test", jwks_uri: "https://identity.example.test/keys" })
    }),
    /does not match/
  );
});

test("OIDC discovery must use a trusted HTTPS JWKS endpoint", async () => {
  await assert.rejects(
    createOidcAuthenticator({
      issuer: ISSUER,
      audience: "export-api",
      fetchImpl: async () => response({ issuer: ISSUER, jwks_uri: "http://attacker.example.test/keys" })
    }),
    /must use HTTPS/
  );
});

test("missing and malformed bearer credentials fail closed", async () => {
  const authenticate = await createOidcAuthenticator({
    issuer: ISSUER,
    audience: "export-api",
    fetchImpl: async () => response({ issuer: ISSUER, jwks_uri: "https://identity.example.test/keys" })
  });
  assert.equal(await authenticate({ headers: {} }), null);
  assert.equal(await authenticate({ headers: { authorization: "Basic abc" } }), null);
  assert.equal(await authenticate({ headers: { authorization: "Bearer not-a-jwt" } }), null);
});
