/**
 * Cloudflare Access (Zero Trust) JWT verification.
 *
 * Cloudflare Access sits in front of the Worker, authenticates the visitor against the configured
 * identity provider, and then forwards the request with two identity headers:
 *
 * - `Cf-Access-Authenticated-User-Email` — plain text, and therefore worthless on its own;
 * - `Cf-Access-Jwt-Assertion` — a signed RS256 token that only Access can produce.
 *
 * A header is trivially forged by anyone who can reach the Worker origin directly, so the signed
 * assertion is the only acceptable evidence of identity. Everything here exists to check that
 * signature and the claims around it. Verification never throws and never partially trusts: any
 * problem at all returns `null` and the caller must treat the request as unauthenticated.
 *
 * Workers-compatible Web APIs only: `fetch`, `crypto.subtle`, `atob`, `TextDecoder`. No npm
 * dependency, and no token, key, or claim value is ever logged.
 */

/** Verified Access identity. `email` is normalized; it is the key the app derives tenancy from. */
export interface AccessIdentity {
  email: string;
  subject: string;
  audience: string;
}

/** Access publishes its signing keys here, relative to the team domain. */
const CERTS_PATH = "/cdn-cgi/access/certs";
/** Access rotates signing keys on the order of weeks; an hour of caching is safe and cheap. */
const KEY_CACHE_TTL_MS = 60 * 60 * 1000;
/** Floor between refetches triggered by an unknown `kid`, so a forged kid cannot become a fetch loop. */
const KEY_REFETCH_MIN_INTERVAL_MS = 60 * 1000;
/** Tolerance for clock drift between Cloudflare's edge and this isolate. */
const CLOCK_SKEW_SECONDS = 60;
const SUPPORTED_ALGORITHM = "RS256";
const IMPORT_PARAMS: RsaHashedImportParams = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const VERIFY_PARAMS: AlgorithmIdentifier = { name: "RSASSA-PKCS1-v1_5" };

interface KeyCache {
  issuer: string;
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

/**
 * Module scope, so keys survive across requests inside one isolate. Cleared by
 * `resetAccessKeyCache()`, which exists for tests and for a deliberate configuration change.
 */
let cache: KeyCache | null = null;
/** In-flight JWKS fetches, keyed by issuer, so concurrent requests share one round trip. */
const inflight = new Map<string, Promise<void>>();

/** Discards cached signing keys. Safe to call at any time; the next verification refetches. */
export function resetAccessKeyCache(): void {
  cache = null;
  inflight.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts `team.cloudflareaccess.com` or `https://team.cloudflareaccess.com/` and returns the bare
 * host. Anything that is not a plain hostname is rejected rather than coerced, because this value
 * becomes both the JWKS origin and the expected `iss` claim.
 */
function normalizeTeamDomain(teamDomain: string): string | null {
  const trimmed = (teamDomain ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!trimmed || !trimmed.includes(".") || !/^[a-z0-9.-]+$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

// The explicit `ArrayBuffer` type argument keeps the result assignable to `BufferSource`, which
// `crypto.subtle.verify` requires; a bare `Uint8Array` widens to `ArrayBufferLike` and is rejected.
function base64UrlToBytes(segment: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const padding = segment.length % 4 === 0 ? 0 : 4 - (segment.length % 4);
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Builds the JWK by hand from validated fields instead of casting the fetched object. An RSA public
 * key is fully described by `n` and `e`; anything else the endpoint returns is ignored on purpose.
 */
function rsaJwk(entry: Record<string, unknown>): JsonWebKey | null {
  const { kty, n, e, alg } = entry;
  if (kty !== "RSA") return null;
  if (typeof alg === "string" && alg !== SUPPORTED_ALGORITHM) return null;
  if (typeof n !== "string" || !n || typeof e !== "string" || !e) return null;
  return { kty: "RSA", n, e, alg: SUPPORTED_ALGORITHM, use: "sig" };
}

async function loadKeys(issuer: string): Promise<void> {
  const response = await fetch(`${issuer}${CERTS_PATH}`, { headers: { accept: "application/json" } });
  // Status only — the body of a failed certs request is not something to echo anywhere.
  if (!response.ok) throw new Error(`Cloudflare Access certs request failed (${response.status}).`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error("Cloudflare Access certs response was not a JWKS.");
  const keys = new Map<string, CryptoKey>();
  for (const entry of body.keys) {
    if (!isRecord(entry)) continue;
    const kid = entry.kid;
    if (typeof kid !== "string" || !kid) continue;
    const jwk = rsaJwk(entry);
    if (!jwk) continue;
    try {
      keys.set(kid, await crypto.subtle.importKey("jwk", jwk, IMPORT_PARAMS, false, ["verify"]));
    } catch {
      // One unusable key must not poison the rest of the key set.
    }
  }
  if (!keys.size) throw new Error("Cloudflare Access certs response contained no usable RS256 keys.");
  cache = { issuer, keys, fetchedAt: Date.now() };
}

async function refreshKeys(issuer: string): Promise<void> {
  const pending = inflight.get(issuer);
  if (pending) return pending;
  const request = loadKeys(issuer).finally(() => {
    inflight.delete(issuer);
  });
  inflight.set(issuer, request);
  return request;
}

/**
 * Resolves the signing key for a `kid`, refetching the JWKS when the key is unknown — that is what a
 * key rotation looks like — but no more often than `KEY_REFETCH_MIN_INTERVAL_MS`.
 */
async function keyForKid(issuer: string, kid: string): Promise<CryptoKey | null> {
  const current = cache;
  if (current && current.issuer === issuer) {
    const age = Date.now() - current.fetchedAt;
    const hit = current.keys.get(kid);
    if (hit && age < KEY_CACHE_TTL_MS) return hit;
    if (!hit && age < KEY_REFETCH_MIN_INTERVAL_MS) return null;
  }
  await refreshKeys(issuer);
  const refreshed = cache;
  if (!refreshed || refreshed.issuer !== issuer) return null;
  return refreshed.keys.get(kid) ?? null;
}

/** The `aud` claim is a string or an array of strings; the configured tag must be among them. */
function audienceMatches(claim: unknown, audience: string): boolean {
  if (typeof claim === "string") return claim === audience;
  if (Array.isArray(claim)) return claim.some((value) => typeof value === "string" && value === audience);
  return false;
}

function numericClaim(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Verifies a `Cf-Access-Jwt-Assertion` value and returns the identity it asserts, or `null`.
 *
 * @param token the raw JWT from the request header
 * @param teamDomain the Zero Trust team domain, e.g. `example.cloudflareaccess.com`
 * @param audience the Access application's AUD tag
 */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  audience: string,
): Promise<AccessIdentity | null> {
  try {
    const domain = normalizeTeamDomain(teamDomain);
    const expectedAudience = (audience ?? "").trim();
    const raw = (token ?? "").trim();
    if (!domain || !expectedAudience || !raw) return null;

    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [headerSegment, payloadSegment, signatureSegment] = parts;

    const header = decodeJsonSegment(headerSegment);
    if (!header || header.alg !== SUPPORTED_ALGORITHM) return null;
    const kid = header.kid;
    if (typeof kid !== "string" || !kid) return null;

    const issuer = `https://${domain}`;
    const key = await keyForKid(issuer, kid);
    if (!key) return null;

    const signature = base64UrlToBytes(signatureSegment);
    if (!signature) return null;
    // The signature covers the encoded header and payload exactly as they arrived, so verify the
    // received bytes rather than anything re-serialized from the decoded objects.
    const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
    if (!(await crypto.subtle.verify(VERIFY_PARAMS, key, signature, signed))) return null;

    // Claims are only read after the signature holds.
    const payload = decodeJsonSegment(payloadSegment);
    if (!payload) return null;
    if (payload.iss !== issuer) return null;
    if (!audienceMatches(payload.aud, expectedAudience)) return null;

    const now = Math.floor(Date.now() / 1000);
    const exp = numericClaim(payload.exp);
    if (exp === null || exp <= now - CLOCK_SKEW_SECONDS) return null;
    const nbf = numericClaim(payload.nbf);
    if (nbf !== null && nbf > now + CLOCK_SKEW_SECONDS) return null;
    const iat = numericClaim(payload.iat);
    if (iat !== null && iat > now + CLOCK_SKEW_SECONDS) return null;

    // A service token carries `common_name` instead of `email`. This app's tenancy key is an advisor
    // email address, so a token without one is not an identity this app can use.
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) return null;
    const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";

    return { email, subject, audience: expectedAudience };
  } catch {
    // Network failure, malformed token, unavailable SubtleCrypto: all of it means "not authenticated".
    return null;
  }
}
