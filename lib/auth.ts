import { env } from "cloudflare:workers";
import { HttpError } from "./http";

/** Authenticated advisor. `ownerId` is the row-level tenancy key for every table. */
export interface Principal {
  ownerId: string;
  email: string;
  displayName: string;
}

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
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

/**
 * Request-based counterpart to `app/chatgpt-auth.ts` (which is server-component only).
 * Returns null when identity is absent and the dev fallback is disabled.
 */
export function resolvePrincipal(request: Request): Principal | null {
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

export function requirePrincipal(request: Request): Principal {
  const principal = resolvePrincipal(request);
  if (!principal) throw new HttpError(401, "Advisor authentication is required.");
  return principal;
}
