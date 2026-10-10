# OIDC Implementation Readiness Checklist

Status: preparation checklist; not an implementation or security attestation.

## Before writing the authentication middleware

- [ ] Select the identity provider and document the trusted issuer URL.
- [ ] Confirm the API access-token audience and access-token format. Do not assume an ID token is accepted by the API.
- [ ] Confirm supported signing algorithms, JWKS discovery, key rotation, and issuer metadata.
- [ ] Decide how external `iss` + `sub` maps to an internal `app_users` record.
- [ ] Define organization selection and verify it against an active membership; never trust an organization ID supplied without membership authorization.
- [ ] Define exact permission names for products, parties, orders, and each order transition.
- [ ] Decide how unknown users and users without an active membership are provisioned or denied.
- [ ] Define a local/test issuer strategy that does not require production credentials in CI.

## Required implementation boundaries

1. Use a maintained OIDC/JWT validation library; do not implement cryptographic JWT verification manually.
2. Pin accepted algorithms and validate signature, issuer, audience, expiry, and not-before claims.
3. Fail closed on missing or invalid configuration; never silently fall back to the shared bearer token.
4. Resolve principal and tenant scope server-side from validated identity and database membership.
5. Apply centralized permission checks to every protected route.
6. Make order authorization, transition validation, state update, and audit insertion transactional and concurrency-safe.
7. Keep tokens and sensitive identity claims out of logs and audit payloads.

## Minimum test matrix

- Missing, malformed, expired, wrong-issuer, wrong-audience, and invalid-signature token.
- Valid token with unknown internal user.
- User with no membership, inactive membership, or membership in a different organization.
- Missing permission and unauthorized action.
- Cross-tenant reads and writes.
- Order submitter attempting to approve their own order.
- Invalid order state and concurrent conflicting transitions.
- JWKS key rotation and identity-provider outage behavior.
- Existing API and PostgreSQL integration tests remain green.

## Release gate

Do not remove the prototype shared-token path or describe the service as enterprise-ready authentication until the chosen provider contract, implementation, route-level tests, tenant-boundary tests, operational configuration, and review have all been completed.
