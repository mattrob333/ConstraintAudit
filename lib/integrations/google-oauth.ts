import { extractErrorMessage, googleOAuthCredentials, readJsonBody, type GoogleOAuthCredentials } from "./env";
import type { Credentials } from "../secrets";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Narrow per-file scope. Google recommends it over full `drive`/`spreadsheets`. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Refresh ~60s early so an in-flight write never carries an expiring token. */
const EXPIRY_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
  grantedScopes: string[];
}

/** Module scope: per-isolate on Workers, so a cold isolate simply re-exchanges. */
const cache = new Map<string, CachedToken>();

/** Bounded so a many-advisor isolate cannot grow the cache without limit. */
const MAX_CACHED_TOKENS = 32;

/**
 * Cache slots are keyed by a SHA-256 fingerprint of the grant (client id + refresh
 * token), never by the refresh token itself: a plain-token key is one stray log or
 * heap dump away from leaking the credential. Because the fingerprint covers the
 * refresh token, two advisors can never read each other's access token, and the
 * env-only path keeps a single stable slot exactly as the previous single-slot
 * cache did.
 */
async function cacheKeyFor(oauth: GoogleOAuthCredentials): Promise<string> {
  const material = new TextEncoder().encode(`${oauth.clientId}\u0000${oauth.refreshToken}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  let key = "";
  for (const byte of digest) key += byte.toString(16).padStart(2, "0");
  return key;
}

function storeToken(key: string, token: CachedToken): void {
  cache.delete(key);
  cache.set(key, token);
  // Map iterates in insertion order, so the first key is the least recently stored.
  while (cache.size > MAX_CACHED_TOKENS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Empty when Google did not report a scope list; never treat that as a denial. */
function uncoveredScopes(requested: readonly string[], granted: readonly string[]): string[] {
  if (!granted.length) return [];
  return requested.filter((scope) => !granted.includes(scope));
}

export type AccessTokenResult =
  | { ok: true; token: string; grantedScopes: string[]; missingScopes: string[] }
  | { ok: false; reason: "not-configured" | "failed"; detail: string };

/**
 * Exchange GOOGLE_REFRESH_TOKEN for an access token.
 *
 * `scopes` is advisory: the refresh-token grant returns whatever scopes the
 * token was originally consented to, so the requested set is only used to
 * report a coverage mismatch rather than to widen access.
 *
 * `credentials`, when supplied, resolves the grant for one advisor; omitted, the
 * Cloudflare environment is read exactly as before.
 */
export async function getAccessTokenResult(
  scopes: readonly string[] = [DRIVE_FILE_SCOPE],
  credentials?: Credentials,
): Promise<AccessTokenResult> {
  const oauth = googleOAuthCredentials(credentials);
  if (!oauth) {
    return {
      ok: false,
      reason: "not-configured",
      detail: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.",
    };
  }

  const key = await cacheKeyFor(oauth);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > now) {
    return {
      ok: true,
      token: cached.token,
      grantedScopes: cached.grantedScopes,
      missingScopes: uncoveredScopes(scopes, cached.grantedScopes),
    };
  }

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        refresh_token: oauth.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    cache.delete(key);
    return { ok: false, reason: "failed", detail: "Google token endpoint did not respond within 10s." };
  }

  const body = await readJsonBody<TokenResponse>(response);
  if (!response.ok) {
    cache.delete(key);
    return {
      ok: false,
      reason: "failed",
      detail: `Google token exchange failed (HTTP ${response.status}): ${extractErrorMessage(body, "no error detail")}`,
    };
  }

  const token = typeof body.json?.access_token === "string" ? body.json.access_token : "";
  if (!token) {
    cache.delete(key);
    return { ok: false, reason: "failed", detail: "Google token exchange returned no access_token." };
  }

  const lifetimeMs = Math.max(0, Number(body.json?.expires_in ?? 0)) * 1000;
  const grantedScopes = (body.json?.scope ?? "").split(/\s+/).filter(Boolean);
  storeToken(key, {
    token,
    expiresAt: now + (lifetimeMs || 3_600_000),
    grantedScopes,
  });

  // A scope gap is not fatal here: the API call itself returns the authoritative
  // authorization error, which the adapter surfaces in `detail`.
  return { ok: true, token, grantedScopes, missingScopes: uncoveredScopes(scopes, grantedScopes) };
}

/** Convenience wrapper: null when unconfigured or when the exchange failed. */
export async function getAccessToken(
  scopes: readonly string[] = [DRIVE_FILE_SCOPE],
  credentials?: Credentials,
): Promise<string | null> {
  const result = await getAccessTokenResult(scopes, credentials);
  return result.ok ? result.token : null;
}

/**
 * Drop cached tokens, e.g. after a 401 from a Google API. Clears every grant:
 * the caller holds a token, not the fingerprint that keys it, and an over-broad
 * eviction only costs one extra exchange.
 */
export function resetAccessTokenCache(): void {
  cache.clear();
}
