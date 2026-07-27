import { CRM_COLUMNS, CRM_MATCH_KEY, DEFAULT_CRM_SHEET_TAB } from "../settings";
import {
  configuredValue,
  defaultSpreadsheetId,
  emailFrom,
  extractErrorMessage,
  googleConfigured,
  missingGoogleVars,
  missingResendVars,
  readJsonBody,
  resendApiKey,
} from "./env";
import { DRIVE_FILE_SCOPE, getAccessTokenResult } from "./google-oauth";
import type { AdapterResult, AdapterStatus } from "./types";

/**
 * Read-only credential/connection verification for the Settings screen.
 *
 * INVARIANT: every path here is a read or a validation call. Nothing in this file ever writes to an
 * external system, and no key, token, or secret is ever returned, logged, or placed in `detail`.
 *
 * The success case is a *read*, which none of the write-oriented AdapterStatus values ("sent",
 * "written", "created") honestly describe — reusing one would falsely imply a side effect. So the
 * status is widened with a read-only "verified". Failure/not-configured reuse the existing values,
 * and the AdapterResult shape (ok / provider / detail / data / externalUrl) is otherwise unchanged.
 */
export type VerificationStatus = AdapterStatus | "verified";
export type VerificationResult<T = unknown> =
  & Omit<AdapterResult<T>, "status">
  & { status: VerificationStatus };

export type VerifiableProvider = "openai" | "resend" | "google_sheets" | "google_docs" | "fireflies";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const RESEND_DOMAINS_URL = "https://api.resend.com/domains";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)";
const FIREFLIES_URL = "https://api.fireflies.ai/graphql";

function notConfigured(provider: string, missing: readonly string[]): VerificationResult {
  return {
    ok: false,
    status: "not-configured",
    provider,
    detail: `Not configured. Missing: ${missing.length ? missing.join(", ") : "credentials"}.`,
  };
}

function fail(provider: string, detail: string): VerificationResult {
  return { ok: false, status: "failed", provider, detail };
}

function verified(provider: string, detail: string, extra: Partial<VerificationResult> = {}): VerificationResult {
  return { ok: true, status: "verified", provider, detail, ...extra };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** A1 notation requires single-quoting any tab name that is not a bare identifier. */
function sheetRange(sheet: string, range: string): string {
  const name = /^[A-Za-z0-9_]+$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  return `${name}!${range}`;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

interface ValueRange {
  values?: unknown[][];
}

async function verifyOpenAI(fetcher: typeof fetch): Promise<VerificationResult> {
  // Mirror openai-research.ts: the key is read from the OPENAI_API_KEY binding.
  const key = configuredValue("OPENAI_API_KEY");
  if (!key) return notConfigured("openai", ["OPENAI_API_KEY"]);
  let response: Response;
  try {
    response = await fetcher(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail("openai", "OpenAI did not respond within 10s.");
  }
  const body = await readJsonBody(response);
  if (response.ok) return verified("openai", "OpenAI API key is valid.");
  if (response.status === 401) {
    return fail("openai", "OpenAI rejected the API key (401). Replace OPENAI_API_KEY with a current key.");
  }
  return fail("openai", `OpenAI returned HTTP ${response.status}: ${extractErrorMessage(body, "no error detail")}.`);
}

async function verifyResend(fetcher: typeof fetch): Promise<VerificationResult> {
  // The credential being tested is the API key; a read of /domains never sends an email.
  const key = resendApiKey();
  if (!key) return notConfigured("resend", missingResendVars());
  let response: Response;
  try {
    response = await fetcher(RESEND_DOMAINS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail("resend", "Resend did not respond within 10s.");
  }
  const body = await readJsonBody(response);
  if (response.ok) {
    const senderNote = emailFrom() ? "" : " Set EMAIL_FROM before sending.";
    return verified("resend", `Resend API key is valid.${senderNote}`);
  }
  if (response.status === 401) {
    return fail("resend", "Resend rejected the API key (401). Replace RESEND_API_KEY with a current key.");
  }
  return fail("resend", `Resend returned HTTP ${response.status}: ${extractErrorMessage(body, "no error detail")}.`);
}

async function verifyGoogleSheets(
  opts: { spreadsheetId?: string; sheetTab?: string } | undefined,
  fetcher: typeof fetch,
): Promise<VerificationResult> {
  if (!googleConfigured()) return notConfigured("google_sheets", missingGoogleVars());

  // BYO sheet: the id comes from the advisor's saved settings (passed in opts). Fall back to any
  // deployment-wide GOOGLE_SHEETS_ID only if one is set; otherwise the advisor must connect a sheet.
  const spreadsheetId = (opts?.spreadsheetId ?? "").trim() || defaultSpreadsheetId();
  if (!spreadsheetId) {
    return {
      ok: false,
      status: "not-configured",
      provider: "google_sheets",
      detail:
        "No CRM spreadsheet is connected. Download the CRM template, import it into your Google account, share it with the app's Google identity, then paste the sheet id in Settings.",
    };
  }
  const tab = (opts?.sheetTab ?? "").trim() || DEFAULT_CRM_SHEET_TAB;

  const token = await getAccessTokenResult([DRIVE_FILE_SCOPE]);
  if (!token.ok) {
    return {
      ok: false,
      status: token.reason === "not-configured" ? "not-configured" : "failed",
      provider: "google_sheets",
      detail: token.detail,
    };
  }

  // READ ONLY: just the header row of the configured tab, mirroring google-sheets.ts's header read.
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetRange(tab, "A1:1"))}?majorDimension=ROWS`;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token.token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail("google_sheets", `Google Sheets did not respond within 15s while reading "${tab}".`);
  }
  const body = await readJsonBody<ValueRange>(response);
  if (!response.ok) {
    const msg = extractErrorMessage(body, "no error detail");
    if (response.status === 404) {
      return fail("google_sheets", `Spreadsheet not found. Check the sheet id, and confirm it is shared with the app's Google identity. (${msg})`);
    }
    if (response.status === 403) {
      return fail("google_sheets", `Access denied to the spreadsheet. Share it with the app's Google identity, then retry. (${msg})`);
    }
    if (response.status === 400) {
      return fail("google_sheets", `Tab "${tab}" was not found, or the range is invalid. Check the CRM tab name in Settings. (${msg})`);
    }
    return fail("google_sheets", `Google Sheets returned HTTP ${response.status}: ${msg}.`);
  }

  const headers = (body.json?.values?.[0] ?? []).map(cellText);
  while (headers.length && !headers[headers.length - 1].trim()) headers.pop();
  if (!headers.length) {
    return fail("google_sheets", `Tab "${tab}" was found but has no header row. Row 1 must name the CRM columns; re-import the template.`);
  }
  const present = new Set(headers.map(normalize).filter(Boolean));
  const missingColumns = CRM_COLUMNS.filter((column) => !present.has(normalize(column)));
  const matched = CRM_COLUMNS.length - missingColumns.length;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // Without the match-key column the write-back cannot find or append rows, so this is not a
  // usable CRM sheet even though the read succeeded.
  if (!present.has(normalize(CRM_MATCH_KEY))) {
    return fail("google_sheets", `Tab "${tab}" is missing the required "${CRM_MATCH_KEY}" column, so rows cannot be matched. Re-import the CRM template.`);
  }

  const base = `Connected. Tab "${tab}" found; ${matched} of ${CRM_COLUMNS.length} CRM columns present.`;
  return verified(
    "google_sheets",
    missingColumns.length
      ? `${base} Missing: ${missingColumns.join(", ")}. Re-import the template to add them; write-back skips absent columns.`
      : base,
    {
      externalUrl: spreadsheetUrl,
      data: { spreadsheetId, sheet: tab, matchedColumns: matched, totalColumns: CRM_COLUMNS.length, missingColumns },
    },
  );
}

interface DriveAbout {
  user?: { emailAddress?: string; displayName?: string };
}

async function verifyGoogleDocs(fetcher: typeof fetch): Promise<VerificationResult> {
  if (!googleConfigured()) return notConfigured("google_docs", missingGoogleVars());

  const token = await getAccessTokenResult([DRIVE_FILE_SCOPE]);
  if (!token.ok) {
    return {
      ok: false,
      status: token.reason === "not-configured" ? "not-configured" : "failed",
      provider: "google_docs",
      detail: token.detail,
    };
  }
  // A scope list is only reported by Google when it narrowed the grant; when reported, drive.file
  // must be covered or document creation cannot work. An empty list means "unknown", never a denial.
  if (token.missingScopes.includes(DRIVE_FILE_SCOPE)) {
    return fail("google_docs", "The Google refresh token was accepted but does not carry the drive.file scope needed to create documents. Re-consent with drive.file granted.");
  }

  // Bonus, non-authoritative: name the account that will own created docs so the advisor shares the
  // right folder with it. about.get may be unavailable under drive.file — that is expected and fine;
  // token success + scope coverage is the verification. No document is ever created here.
  let identity = "";
  try {
    const response = await fetcher(DRIVE_ABOUT_URL, {
      headers: { Authorization: `Bearer ${token.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const body = await readJsonBody<DriveAbout>(response);
      identity = body.json?.user?.emailAddress?.trim() || body.json?.user?.displayName?.trim() || "";
    }
  } catch {
    // Ignore: the fallback (token + scope check) already succeeded.
  }

  return verified(
    "google_docs",
    identity
      ? `Google document creation is authorized (drive.file scope). Documents are created by ${identity}; share target folders with that account.`
      : "Google document creation is authorized (drive.file scope granted).",
  );
}

interface FirefliesUser {
  data?: { user?: { user_id?: string; name?: string } };
  errors?: Array<{ message?: string }>;
}

async function verifyFireflies(fetcher: typeof fetch): Promise<VerificationResult> {
  // Mirror fireflies.ts: the key is read from the FIREFLIES_API_KEY binding.
  const key = configuredValue("FIREFLIES_API_KEY");
  if (!key) return notConfigured("fireflies", ["FIREFLIES_API_KEY"]);
  let response: Response;
  try {
    response = await fetcher(FIREFLIES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      // Minimal read: the current user. No transcript is fetched, moved, or shared.
      body: JSON.stringify({ query: "query { user { user_id name } }" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail("fireflies", "Fireflies did not respond within 15s.");
  }
  const body = await readJsonBody<FirefliesUser>(response);
  if (response.status === 401) return fail("fireflies", "Fireflies rejected the API key (401).");
  if (!response.ok) {
    return fail("fireflies", `Fireflies returned HTTP ${response.status}: ${extractErrorMessage(body, "no error detail")}.`);
  }
  if (body.json?.errors?.length) {
    return fail("fireflies", `Fireflies error: ${body.json.errors.map((item) => item.message || "unknown").join("; ")}.`);
  }
  const user = body.json?.data?.user;
  if (!user?.user_id) {
    return fail("fireflies", "Fireflies responded but returned no current user; the key may lack access.");
  }
  return verified("fireflies", `Fireflies key is valid${user.name ? ` (authenticated as ${user.name})` : ""}.`);
}

/**
 * Verify a single provider with a read-only call. `opts` carries the advisor's BYO CRM sheet id/tab
 * for google_sheets. `fetcher` is injectable for testing; it defaults to the platform `fetch`.
 */
export async function verifyProvider(
  provider: VerifiableProvider,
  opts?: { spreadsheetId?: string; sheetTab?: string },
  fetcher: typeof fetch = fetch,
): Promise<VerificationResult> {
  switch (provider) {
    case "openai":
      return verifyOpenAI(fetcher);
    case "resend":
      return verifyResend(fetcher);
    case "google_sheets":
      return verifyGoogleSheets(opts, fetcher);
    case "google_docs":
      return verifyGoogleDocs(fetcher);
    case "fireflies":
      return verifyFireflies(fetcher);
    default:
      return fail(String(provider), `Unknown provider "${String(provider)}".`);
  }
}
