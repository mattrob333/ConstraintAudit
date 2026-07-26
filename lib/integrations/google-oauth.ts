import { extractErrorMessage, googleOAuthCredentials, readJsonBody } from "./env";

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
let cached: CachedToken | null = null;

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
 */
export async function getAccessTokenResult(
  scopes: readonly string[] = [DRIVE_FILE_SCOPE],
): Promise<AccessTokenResult> {
  const credentials = googleOAuthCredentials();
  if (!credentials) {
    return {
      ok: false,
      reason: "not-configured",
      detail: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.",
    };
  }

  const now = Date.now();
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
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    cached = null;
    return { ok: false, reason: "failed", detail: "Google token endpoint did not respond within 10s." };
  }

  const body = await readJsonBody<TokenResponse>(response);
  if (!response.ok) {
    cached = null;
    return {
      ok: false,
      reason: "failed",
      detail: `Google token exchange failed (HTTP ${response.status}): ${extractErrorMessage(body, "no error detail")}`,
    };
  }

  const token = typeof body.json?.access_token === "string" ? body.json.access_token : "";
  if (!token) {
    cached = null;
    return { ok: false, reason: "failed", detail: "Google token exchange returned no access_token." };
  }

  const lifetimeMs = Math.max(0, Number(body.json?.expires_in ?? 0)) * 1000;
  const grantedScopes = (body.json?.scope ?? "").split(/\s+/).filter(Boolean);
  cached = {
    token,
    expiresAt: now + (lifetimeMs || 3_600_000),
    grantedScopes,
  };

  // A scope gap is not fatal here: the API call itself returns the authoritative
  // authorization error, which the adapter surfaces in `detail`.
  return { ok: true, token, grantedScopes, missingScopes: uncoveredScopes(scopes, grantedScopes) };
}

/** Convenience wrapper: null when unconfigured or when the exchange failed. */
export async function getAccessToken(
  scopes: readonly string[] = [DRIVE_FILE_SCOPE],
): Promise<string | null> {
  const result = await getAccessTokenResult(scopes);
  return result.ok ? result.token : null;
}

/** Drop the cached token, e.g. after a 401 from a Google API. */
export function resetAccessTokenCache(): void {
  cached = null;
}
