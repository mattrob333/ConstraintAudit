import { env } from "cloudflare:workers";
import type { Credentials } from "../secrets";

/**
 * Single place that reads integration configuration and reports what is usable.
 *
 * Credential accessors below are module-internal to lib/integrations. They must
 * never be re-exported from index.ts, returned in an AdapterResult, or logged.
 *
 * Every accessor takes an optional `Credentials`. Omitting it reads the Cloudflare
 * environment exactly as before, so existing callers are unaffected.
 */

function bindings(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

export function configuredValue(name: string): string {
  const value = bindings()[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve one name-to-value reader. With no `credentials` this is `configuredValue`
 * itself — the env-only path is unchanged, not merely equivalent.
 */
export function readerFor(credentials?: Credentials): (name: string) => string {
  if (!credentials) return configuredValue;
  return (name) => credentials.get(name).trim();
}

function missingOf(names: readonly string[], credentials?: Credentials): string[] {
  const read = readerFor(credentials);
  return names.filter((name) => read(name).length === 0);
}

export const RESEND_VARS = ["RESEND_API_KEY", "EMAIL_FROM"] as const;
export const GOOGLE_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"] as const;
export const GOOGLE_SHEETS_VARS = [...GOOGLE_VARS, "GOOGLE_SHEETS_ID"] as const;

export function resendConfigured(credentials?: Credentials): boolean {
  return missingOf(RESEND_VARS, credentials).length === 0;
}

export function googleConfigured(credentials?: Credentials): boolean {
  return missingOf(GOOGLE_VARS, credentials).length === 0;
}

export function googleSheetsConfigured(credentials?: Credentials): boolean {
  return missingOf(GOOGLE_SHEETS_VARS, credentials).length === 0;
}

/** A Drive root folder is optional: without it files land in My Drive. */
export function googleDriveConfigured(credentials?: Credentials): boolean {
  return googleConfigured(credentials);
}

export function missingResendVars(credentials?: Credentials): string[] {
  return missingOf(RESEND_VARS, credentials);
}

export function missingGoogleVars(credentials?: Credentials): string[] {
  return missingOf(GOOGLE_VARS, credentials);
}

export function missingGoogleSheetsVars(credentials?: Credentials): string[] {
  return missingOf(GOOGLE_SHEETS_VARS, credentials);
}

/** Non-secret identifiers. */
export function defaultSpreadsheetId(credentials?: Credentials): string {
  return readerFor(credentials)("GOOGLE_SHEETS_ID");
}

export function defaultDriveFolderId(credentials?: Credentials): string {
  return readerFor(credentials)("GOOGLE_DRIVE_ROOT_FOLDER_ID");
}

export function emailFrom(credentials?: Credentials): string {
  return readerFor(credentials)("EMAIL_FROM");
}

export function emailReplyTo(credentials?: Credentials): string {
  return readerFor(credentials)("EMAIL_REPLY_TO");
}

/** Secrets. Internal to lib/integrations. */
export function resendApiKey(credentials?: Credentials): string {
  return readerFor(credentials)("RESEND_API_KEY");
}

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function googleOAuthCredentials(credentials?: Credentials): GoogleOAuthCredentials | null {
  const read = readerFor(credentials);
  const clientId = read("GOOGLE_CLIENT_ID");
  const clientSecret = read("GOOGLE_CLIENT_SECRET");
  const refreshToken = read("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

/**
 * Provider bodies are not reliably JSON (proxies and gateways return HTML/text).
 * Read once as text, then attempt a parse.
 */
export async function readJsonBody<T>(response: Response): Promise<{ json?: T; text: string }> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return { text: "" };
  }
  if (!text.trim()) return { text: "" };
  try {
    return { json: JSON.parse(text) as T, text };
  } catch {
    return { text };
  }
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Best-effort human-readable message from an arbitrary provider error body. */
export function extractErrorMessage(body: { json?: unknown; text: string }, fallback: string): string {
  const json = body.json;
  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    const nested = record.error;
    if (typeof nested === "string") {
      return [nested, stringField(record, "error_description")].filter(Boolean).join(": ") || fallback;
    }
    if (nested && typeof nested === "object") {
      const inner = nested as Record<string, unknown>;
      const message = stringField(inner, "message") || stringField(inner, "status");
      if (message) return message;
    }
    const message = stringField(record, "message") || stringField(record, "name");
    if (message) return message;
  }
  const text = body.text.trim();
  if (!text) return fallback;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
