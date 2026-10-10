import { createRemoteJWKSet, jwtVerify } from "jose";

function trustedUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error(`${label} must use HTTPS`);
  return url;
}

export async function createOidcAuthenticator({ issuer, audience, fetchImpl = globalThis.fetch }) {
  if (typeof issuer !== "string" || !issuer.trim()) throw new Error("OIDC_ISSUER is required");
  if (typeof audience !== "string" || !audience.trim()) throw new Error("OIDC_AUDIENCE is required");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  const issuerUrl = trustedUrl(issuer, "OIDC_ISSUER");
  const issuerBase = issuerUrl.href.endsWith("/") ? issuerUrl.href.slice(0, -1) : issuerUrl.href;
  const discoveryUrl = new URL(`${issuerBase}/.well-known/openid-configuration`);
  const response = await fetchImpl(discoveryUrl, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("OIDC discovery request failed");
  const metadata = await response.json();
  if (!metadata || metadata.issuer !== issuer) throw new Error("OIDC discovery issuer does not match OIDC_ISSUER");
  if (typeof metadata.jwks_uri !== "string") throw new Error("OIDC discovery document has no jwks_uri");
  const jwksUrl = trustedUrl(metadata.jwks_uri, "OIDC jwks_uri");
  const keySet = createRemoteJWKSet(jwksUrl);

  return async function authenticate(req) {
    const header = req?.headers?.authorization;
    if (typeof header !== "string") return null;
    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1] || Array.from(parts[1]).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return null;
    try {
      const { payload } = await jwtVerify(parts[1], keySet, {
        issuer,
        audience,
        algorithms: ["RS256", "ES256", "PS256", "EdDSA"]
      });
      if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
      if (typeof payload.iss !== "string" || payload.iss !== issuer) return null;
      return { issuer: payload.iss, subject: payload.sub };
    } catch {
      return null;
    }
  };
}
