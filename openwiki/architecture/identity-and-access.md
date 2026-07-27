---
type: Architecture Reference
title: Identity and Access
description: How an advisor is identified, the four advisor auth modes, Cloudflare Access JWT verification, the precedence chain, and what remains unproven.
tags: [architecture, auth, cloudflare-access, jwt, tenancy, identity]
---

# Identity and access

Tenancy in this application is one advisor email address. Everything else — `ownerId`, row scoping, the practice-engagement id — is derived from it. That makes identity resolution the security boundary, so this page states exactly what is checked.

## The precedence chain

`resolvePrincipalAsync()` in `lib/auth.ts` resolves a `Principal` in this order:

1. a **signature-verified Cloudflare Access assertion**, when Access is configured;
2. the **OpenAI Sites identity headers** (`oai-authenticated-user-email`, plus an optional percent-encoded full name);
3. the **`LOCAL_ADVISOR_EMAIL` fallback**, only while `REQUIRE_ADVISOR_AUTH` is falsy.

When Access is configured it is the *only* accepted source. A missing, malformed, or unverifiable assertion returns `null` rather than falling through to a spoofable header or to the shared local advisor — otherwise a request that bypassed Access by reaching the Worker origin directly would authenticate as an advisor.

`requirePrincipalAsync()` raises `HttpError(401, "Advisor authentication is required.")` when nothing resolves.

**Every one of the 25 route files under `app/api/` calls `requirePrincipalAsync`.** The synchronous `resolvePrincipal` / `requirePrincipal` still exist and remain behaviourally unchanged for the Sites and local-development paths, but they have **zero call sites** in the API surface. They deliberately ignore `Cf-Access-Jwt-Assertion` entirely rather than trusting it unverified, because verifying a signature requires a fetch and cannot be done synchronously.

## The four auth modes

`advisorAuthMode()` reports which identity source is in force. `GET /api/integrations` surfaces it as the `advisor_auth` entry so the Integration Center states the truth instead of assuming Sites headers.

| Mode | Condition | Meaning |
| --- | --- | --- |
| `cloudflare-access` | `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` both set | Identity comes from a signature-verified Access assertion. The only trustworthy mode when self-hosted on Cloudflare Workers |
| `sites-headers` | No Access configuration, `REQUIRE_ADVISOR_AUTH` on | Only the Sites-injected header is accepted. Safe **only** while the app is genuinely behind Sites, which strips client-supplied copies of it |
| `local-fallback` | No Access configuration, `REQUIRE_ADVISOR_AUTH` off | A Sites header is honoured if present; otherwise every visitor becomes the single `LOCAL_ADVISOR_EMAIL` advisor and can see every engagement. `npm run dev` and the test suite only |
| `denied` | Exactly one of the two `CF_ACCESS_*` bindings set while `REQUIRE_ADVISOR_AUTH` is on | Nothing can authenticate. Enforced and reported rather than silently downgraded to header trust, because a half-finished Access rollout is when header trust is most dangerous |

The `denied` mode is the design decision worth preserving: a half-configured Access rollout fails closed and says so, instead of quietly becoming `sites-headers` on a host that is not Sites.

## What `verifyAccessJwt` actually checks

Cloudflare Access forwards two headers. `Cf-Access-Authenticated-User-Email` is plain text and therefore worthless on its own; `Cf-Access-Jwt-Assertion` is an RS256 token only Access can produce. `lib/access-jwt.ts` reads the second and ignores the first.

Verification, in order:

1. the team domain normalizes to a bare hostname, or the whole thing is rejected — that value becomes both the JWKS origin and the expected `iss`;
2. the token has exactly three segments and its header declares `alg: RS256` with a non-empty `kid`;
3. the signing key for that `kid` is resolved from `https://<team-domain>/cdn-cgi/access/certs`, cached for an hour in module scope, refetched when a `kid` is unknown but no more often than once a minute so a forged `kid` cannot become a fetch loop, with concurrent fetches per issuer shared through one in-flight promise;
4. the signature is verified over **the received header and payload bytes**, not over anything re-serialized from the decoded objects;
5. **only then** are claims read: `iss` must equal the issuer, `aud` must contain the configured AUD tag (string or array form), `exp` must be in the future and `nbf` / `iat` must not be in the future, each with 60 seconds of clock-skew tolerance;
6. a non-empty `email` claim is required. A service token carries `common_name` instead, and this app's tenancy key is an advisor email, so such a token is not an identity it can use.

The module is Workers-compatible Web APIs only — `fetch`, `crypto.subtle`, `atob`, `TextDecoder` — with no npm dependency. It never throws and never partially trusts: any problem at all returns `null` and the caller must treat the request as unauthenticated. No token, key, or claim value is logged.

`resetAccessKeyCache()` exists for tests and for a deliberate configuration change.

## Configuration

| Variable | Effect |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust team domain, e.g. `yourteam.cloudflareaccess.com`. Where signing keys are fetched from and the expected `iss` |
| `CF_ACCESS_AUD` | The Access application's AUD tag. A token issued for a different application is rejected |
| `REQUIRE_ADVISOR_AUTH` | Set to `1` to disable the unauthenticated fallback entirely |
| `LOCAL_ADVISOR_EMAIL` | The single fallback advisor. Meaningful only when `REQUIRE_ADVISOR_AUTH` is unset — a local-development configuration, not a production one |
| `LEGACY_OWNER_EMAIL` | Claims rows written before tenancy existed. Defaults to `LOCAL_ADVISOR_EMAIL` |

Ordering matters, and `docs/DEPLOYMENT.md` states it: set `LEGACY_OWNER_EMAIL` to the real advisor address before the first deploy that enables `REQUIRE_ADVISOR_AUTH`, or pre-tenancy rows are claimed by the local fallback identity and become unreachable.

## The second door

Cloudflare Access protects hostnames on a zone in your own Cloudflare account. It **cannot** be put in front of a `*.workers.dev` URL. `wrangler.jsonc` ships with `"workers_dev": true` for a first smoke test and says in its own comments to set it to `false` once Access is in place, serving from a custom domain instead.

`lib/auth.ts` does fail closed on that door — with `CF_ACCESS_*` configured, a request arriving without a verified assertion gets 401 — but leaving `workers_dev` enabled leaves a second entrance Access never sees. Do not rely on the application layer alone.

## Status

| Element | Status |
| --- | --- |
| `verifyAccessJwt` signature, issuer, audience, and expiry checks | Implemented |
| JWKS fetch, cache, and rotation handling | Implemented |
| `advisorAuthMode()` and the four-mode report on `/api/integrations` | Implemented |
| All 25 API routes on `requirePrincipalAsync` | Implemented |
| Automated test coverage of `verifyAccessJwt` | **None.** No test in `tests/` imports `lib/access-jwt.ts` |
| Verification against a live Cloudflare Access deployment | Not evidenced anywhere in this repository |
| Per-advisor OAuth (an advisor acting as themselves against Google) | Not implemented. Google actions use one service refresh token for the whole deployment |
| Organization or team layer above the individual advisor | Not implemented |
| Rate limiting, retention, deletion policy | Not implemented |

The honest summary: the identity code is thorough and fails closed in every branch that was read, and none of it is covered by an automated test or by recorded evidence of a live Access sign-in. Treat it as implemented-but-unproven.
