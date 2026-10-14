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


test("OIDC authenticator verifies a signed JWT and rejects wrong audience, issuer, and expiry", async () => {
  const { createServer } = await import("node:http");
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "integration-test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const server = createServer((req, res) => {
    if (req.url !== "/keys") {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const issuer = "http://127.0.0.1:" + server.address().port;
  try {
    const authenticate = await createOidcAuthenticator({
      issuer,
      audience: "export-api",
      fetchImpl: async () => response({ issuer, jwks_uri: issuer + "/keys" })
    });
    const makeToken = ({ tokenIssuer = issuer, audience = "export-api", expiration = Math.floor(Date.now() / 1000) + 60 } = {}) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setIssuer(tokenIssuer)
        .setAudience(audience)
        .setSubject("subject-123")
        .setIssuedAt()
        .setExpirationTime(expiration)
        .sign(privateKey);

    const valid = await makeToken();
    assert.deepEqual(await authenticate({ headers: { authorization: "Bearer " + valid } }), {
      issuer,
      subject: "subject-123"
    });
    const wrongAudience = await makeToken({ audience: "other-api" });
    assert.equal(await authenticate({ headers: { authorization: "Bearer " + wrongAudience } }), null);
    const wrongIssuer = await makeToken({ tokenIssuer: "http://127.0.0.1:1" });
    assert.equal(await authenticate({ headers: { authorization: "Bearer " + wrongIssuer } }), null);
    const expired = await makeToken({ expiration: Math.floor(Date.now() / 1000) - 10 });
    assert.equal(await authenticate({ headers: { authorization: "Bearer " + expired } }), null);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("OIDC authenticator rejects tokens that are not yet valid", async () => {
  const { createServer } = await import("node:http");
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "not-before-test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/keys" ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(req.url === "/keys" ? JSON.stringify({ keys: [jwk] }) : "");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const issuer = "http://127.0.0.1:" + server.address().port;
  try {
    const authenticate = await createOidcAuthenticator({
      issuer,
      audience: "export-api",
      fetchImpl: async () => response({ issuer, jwks_uri: issuer + "/keys" })
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .setIssuer(issuer)
      .setAudience("export-api")
      .setSubject("subject-123")
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000) + 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(privateKey);
    assert.equal(await authenticate({ headers: { authorization: "Bearer " + token } }), null);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("OIDC authenticator rejects tokens signed with an unsupported algorithm", async () => {
  const { createServer } = await import("node:http");
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "algorithm-test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const server = createServer((req, res) => {
    res.writeHead(req.url === "/keys" ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(req.url === "/keys" ? JSON.stringify({ keys: [jwk] }) : "");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const issuer = "http://127.0.0.1:" + server.address().port;
  try {
    const authenticate = await createOidcAuthenticator({
      issuer,
      audience: "export-api",
      fetchImpl: async () => response({ issuer, jwks_uri: issuer + "/keys" })
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: jwk.kid })
      .setIssuer(issuer)
      .setAudience("export-api")
      .setSubject("subject-123")
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(new TextEncoder().encode("not-the-rsa-key"));
    assert.equal(await authenticate({ headers: { authorization: "Bearer " + token } }), null);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
