import { env } from "cloudflare:workers";

/**
 * Single place that reads integration configuration and reports what is usable.
 *
 * Credential accessors below are module-internal to lib/integrations. They must
 * never be re-exported from index.ts, returned in an AdapterResult, or logged.
 */

function bindings(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

export function configuredValue(name: string): string {
  const value = bindings()[name];
  return typeof value === "string" ? value.trim() : "";
}

function missingOf(names: readonly string[]): string[] {
  return names.filter((name) => configuredValue(name).length === 0);
}

export const RESEND_VARS = ["RESEND_API_KEY", "EMAIL_FROM"] as const;
export const GOOGLE_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"] as const;
export const GOOGLE_SHEETS_VARS = [...GOOGLE_VARS, "GOOGLE_SHEETS_ID"] as const;

export function resendConfigured(): boolean {
  return missingOf(RESEND_VARS).length === 0;
}

export function googleConfigured(): boolean {
  return missingOf(GOOGLE_VARS).length === 0;
}

export function googleSheetsConfigured(): boolean {
  return missingOf(GOOGLE_SHEETS_VARS).length === 0;
}

/** A Drive root folder is optional: without it files land in My Drive. */
export function googleDriveConfigured(): boolean {
  return googleConfigured();
}

export function missingResendVars(): string[] {
  return missingOf(RESEND_VARS);
}

export function missingGoogleVars(): string[] {
  return missingOf(GOOGLE_VARS);
}

export function missingGoogleSheetsVars(): string[] {
  return missingOf(GOOGLE_SHEETS_VARS);
}

/** Non-secret identifiers. */
export function defaultSpreadsheetId(): string {
  return configuredValue("GOOGLE_SHEETS_ID");
}

export function defaultDriveFolderId(): string {
  return configuredValue("GOOGLE_DRIVE_ROOT_FOLDER_ID");
}

export function emailFrom(): string {
  return configuredValue("EMAIL_FROM");
}

export function emailReplyTo(): string {
  return configuredValue("EMAIL_REPLY_TO");
}

/** Secrets. Internal to lib/integrations. */
export function resendApiKey(): string {
  return configuredValue("RESEND_API_KEY");
}

export function googleOAuthCredentials(): { clientId: string; clientSecret: string; refreshToken: string } | null {
  const clientId = configuredValue("GOOGLE_CLIENT_ID");
  const clientSecret = configuredValue("GOOGLE_CLIENT_SECRET");
  const refreshToken = configuredValue("GOOGLE_REFRESH_TOKEN");
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
