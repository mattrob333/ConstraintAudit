import { env } from "cloudflare:workers";
import { verifyAccessJwt } from "./access-jwt";
import { HttpError } from "./http";

/** Authenticated advisor. `ownerId` is the row-level tenancy key for every table. */
export interface Principal {
  ownerId: string;
  email: string;
  displayName: string;
}

/**
 * Which identity source this deployment is configured to use.
 *
 * - `cloudflare-access` — `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are both set, so identity
 *   comes from a signature-verified Access assertion. The only trustworthy mode when the app is
 *   self-hosted on Cloudflare Workers.
 * - `sites-headers` — no Access configuration, but `REQUIRE_ADVISOR_AUTH` is on, so the only
 *   accepted identity is the `oai-authenticated-user-email` header injected by OpenAI Sites. Safe
 *   only while the app is genuinely behind Sites, which strips client-supplied copies of it.
 * - `local-fallback` — no Access configuration and no `REQUIRE_ADVISOR_AUTH`. A Sites header is
 *   honoured when present; otherwise every visitor becomes the single `LOCAL_ADVISOR_EMAIL`
 *   advisor and can see every engagement. Intended for `npm run dev` and the test suite only.
 * - `denied` — Access is half-configured (one of the two bindings) while `REQUIRE_ADVISOR_AUTH` is
 *   on. Nothing can authenticate. Reported and enforced rather than silently downgraded to header
 *   trust, because a half-finished Access rollout is exactly when header trust is most dangerous.
 */
export type AdvisorAuthMode = "cloudflare-access" | "sites-headers" | "local-fallback" | "denied";

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
/** Injected by Cloudflare Access. Signed, and the only header here that is worth trusting. */
const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const DEFAULT_LOCAL_ADVISOR_EMAIL = "local-advisor@localhost";
const TRUTHY = ["1", "true", "yes", "on"];

/** Bindings are absent under `next build` and in plain node test runs; never let that throw. */
function binding(name: string): string {
  try {
    const value = (env as unknown as Record<string, unknown>)[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/** When set, the unauthenticated dev fallback is disabled and every request must carry identity. */
export function advisorAuthRequired(): boolean {
  return TRUTHY.includes(binding("REQUIRE_ADVISOR_AUTH").toLowerCase());
}

/** Sole advisor used by `npm run dev` and the test suite when no identity header is present. */
export function localAdvisorEmail(): string {
  return binding("LOCAL_ADVISOR_EMAIL") || DEFAULT_LOCAL_ADVISOR_EMAIL;
}

/** Owner claimed for rows written before tenancy existed. See the backfill in lib/store.ts. */
export function legacyOwnerEmail(): string {
  return binding("LEGACY_OWNER_EMAIL") || localAdvisorEmail();
}

type AccessConfiguration =
  | { state: "configured"; teamDomain: string; audience: string }
  | { state: "absent" }
  | { state: "misconfigured" };

/** Cloudflare Access needs both halves: a team domain to fetch keys from and an AUD tag to match. */
function accessConfiguration(): AccessConfiguration {
  const teamDomain = binding("CF_ACCESS_TEAM_DOMAIN");
  const audience = binding("CF_ACCESS_AUD");
  if (teamDomain && audience) return { state: "configured", teamDomain, audience };
  if (teamDomain || audience) return { state: "misconfigured" };
  return { state: "absent" };
}

/**
 * Reports the identity source in force, so `/api/integrations` can state the truth instead of
 * assuming Sites headers. See `AdvisorAuthMode` for what each value means.
 */
export function advisorAuthMode(): AdvisorAuthMode {
  const access = accessConfiguration();
  if (access.state === "configured") return "cloudflare-access";
  if (access.state === "misconfigured" && advisorAuthRequired()) return "denied";
  return advisorAuthRequired() ? "sites-headers" : "local-fallback";
}

function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * Deterministic, synchronous owner id. The normalized email is the authority — this is a stable
 * short handle for it, not a secret. Synchronous by requirement, so no SubtleCrypto.
 */
export function ownerIdForEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("An advisor email is required to derive an owner id.");
  const high = fnv1a(normalized, 0x811c9dc5);
  const low = fnv1a(`${normalized}:${normalized.length}`, 0x01000193);
  return `own_${hex8(high)}${hex8(low)}`;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function principalFor(email: string, displayName?: string | null): Principal {
  const normalized = normalizeEmail(email);
  return {
    ownerId: ownerIdForEmail(normalized),
    email: normalized,
    displayName: displayName?.trim() || normalized,
  };
}

/** Sources 2 and 3 of the precedence chain: the OpenAI Sites headers, then the local fallback. */
function resolveSitesOrLocalPrincipal(request: Request): Principal | null {
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim() ?? "";
  if (email) {
    const encodedFullName = request.headers.get(USER_FULL_NAME_HEADER);
    const fullName =
      encodedFullName &&
      request.headers.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
        ? safeDecodeURIComponent(encodedFullName)
        : null;
    return principalFor(email, fullName);
  }
  if (advisorAuthRequired()) return null;
  return principalFor(localAdvisorEmail());
}

/**
 * Request-based counterpart to `app/chatgpt-auth.ts` (which is server-component only).
 * Returns null when identity is absent and the dev fallback is disabled.
 *
 * **Do not use this on a deployment where Cloudflare Access is the identity provider.** Verifying
 * an Access assertion means fetching and checking a signature, which cannot be done synchronously,
 * so this function ignores `Cf-Access-Jwt-Assertion` entirely rather than trusting it unverified.
 * On an Access deployment (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`, and `REQUIRE_ADVISOR_AUTH=1`
 * as documented in docs/DEPLOYMENT.md) there is no Sites header either, so this returns null and
 * the caller answers 401. That is the safe failure, but it is still a failure: routes on such a
 * deployment must call `resolvePrincipalAsync` / `requirePrincipalAsync`.
 *
 * Kept synchronous and behaviourally unchanged for the OpenAI Sites and local-development paths.
 */
export function resolvePrincipal(request: Request): Principal | null {
  if (advisorAuthMode() === "denied") return null;
  return resolveSitesOrLocalPrincipal(request);
}

export function requirePrincipal(request: Request): Principal {
  const principal = resolvePrincipal(request);
  if (!principal) throw new HttpError(401, "Advisor authentication is required.");
  return principal;
}

/**
 * Full principal resolution, in precedence order:
 *
 * 1. a signature-verified Cloudflare Access assertion, when Access is configured;
 * 2. the OpenAI Sites identity headers;
 * 3. the `LOCAL_ADVISOR_EMAIL` fallback, only while `REQUIRE_ADVISOR_AUTH` is falsy.
 *
 * When Access is configured it is the *only* accepted source: a missing, malformed, or
 * unverifiable assertion returns null instead of falling through to a spoofable header or to the
 * shared local advisor. Anything else would let a request that bypassed Access — by reaching the
 * Worker origin directly — authenticate as an advisor.
 */
export async function resolvePrincipalAsync(request: Request): Promise<Principal | null> {
  const access = accessConfiguration();
  if (access.state === "misconfigured" && advisorAuthRequired()) return null;
  if (access.state === "configured") {
    const token = request.headers.get(ACCESS_JWT_HEADER)?.trim() ?? "";
    if (!token) return null;
    const identity = await verifyAccessJwt(token, access.teamDomain, access.audience);
    // The assertion carries no display name, so the email stands in for it, as it does elsewhere.
    return identity ? principalFor(identity.email) : null;
  }
  return resolveSitesOrLocalPrincipal(request);
}

export async function requirePrincipalAsync(request: Request): Promise<Principal> {
  const principal = await resolvePrincipalAsync(request);
  if (!principal) throw new HttpError(401, "Advisor authentication is required.");
  return principal;
}
