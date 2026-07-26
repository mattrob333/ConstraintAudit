import { defaultSpreadsheetId, extractErrorMessage, googleConfigured, missingGoogleSheetsVars, readJsonBody } from "./env";
import { DRIVE_FILE_SCOPE, getAccessTokenResult } from "./google-oauth";
import type { AdapterResult, AppendOrUpdateRowData, AppendOrUpdateRowInput } from "./types";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const PROVIDER = "google_sheets";

interface ValueRange {
  range?: string;
  values?: unknown[][];
}

interface UpdateResponse {
  updatedRange?: string;
}

interface AppendResponse {
  updates?: { updatedRange?: string };
}

function fail(detail: string): AdapterResult<AppendOrUpdateRowData> {
  return { ok: false, status: "failed", provider: PROVIDER, detail };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** A1 notation requires single-quoting any tab name that is not a bare identifier. */
function sheetRange(sheet: string, range: string): string {
  const name = /^[A-Za-z0-9_]+$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  return `${name}!${range}`;
}

function valuesUrl(spreadsheetId: string, range: string, suffix = "", query = ""): string {
  return `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${suffix}${query}`;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function rowNumberOf(updatedRange: string | undefined): number | undefined {
  const match = /![A-Z]+(\d+)/.exec(updatedRange ?? "");
  return match ? Number(match[1]) : undefined;
}

async function sheetsRequest(
  url: string,
  token: string,
  init: { method: string; body?: string },
): Promise<{ response: Response } | { error: string }> {
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
      signal: AbortSignal.timeout(20_000),
    });
    return { response };
  } catch {
    return { error: `Google Sheets did not respond within 20s (${init.method}).` };
  }
}

/**
 * Write exactly one CRM row: update the row whose `matchKey` cell already holds the
 * key, otherwise append. Values are ordered against the live header row, so a
 * reordered or renamed column cannot scramble the data — unrecognised keys are
 * reported in `detail` rather than written to the wrong column or dropped silently.
 */
export async function appendOrUpdateRow(
  input: AppendOrUpdateRowInput,
): Promise<AdapterResult<AppendOrUpdateRowData>> {
  const spreadsheetId = (input.spreadsheetId ?? defaultSpreadsheetId()).trim();
  if (!googleConfigured() || !spreadsheetId) {
    const missing = missingGoogleSheetsVars();
    return {
      ok: false,
      status: "not-configured",
      provider: PROVIDER,
      detail: `Google Sheets is not configured. Missing: ${(missing.length ? missing : ["GOOGLE_SHEETS_ID"]).join(", ")}.`,
    };
  }

  const sheet = input.sheet.trim();
  if (!sheet) return fail("A sheet (tab) name is required.");
  const matchKey = input.matchKey.trim();
  if (!matchKey) return fail("A matchKey column is required so the write stays idempotent.");
  const matchValue = (input.matchValue ?? cellText(input.row[matchKey])).trim();
  if (!matchValue) {
    return fail(`Refusing to write: no value for match column "${matchKey}". Blind appends would duplicate rows.`);
  }

  const token = await getAccessTokenResult([DRIVE_FILE_SCOPE]);
  if (!token.ok) {
    return {
      ok: false,
      status: token.reason === "not-configured" ? "not-configured" : "failed",
      provider: PROVIDER,
      detail: token.detail,
    };
  }
  const scopeNote = token.missingScopes.length
    ? ` The refresh token does not carry ${token.missingScopes.join(", ")}.`
    : "";
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 1. Header row defines column order.
  const headerCall = await sheetsRequest(
    valuesUrl(spreadsheetId, sheetRange(sheet, "A1:1"), "", "?majorDimension=ROWS"),
    token.token,
    { method: "GET" },
  );
  if ("error" in headerCall) return fail(headerCall.error);
  const headerBody = await readJsonBody<ValueRange>(headerCall.response);
  if (!headerCall.response.ok) {
    return fail(`Google Sheets returned HTTP ${headerCall.response.status} reading the header of "${sheet}": ${extractErrorMessage(headerBody, "no error detail")}.${scopeNote}`);
  }
  const headers = (headerBody.json?.values?.[0] ?? []).map(cellText);
  while (headers.length && !headers[headers.length - 1].trim()) headers.pop();
  if (!headers.length) return fail(`Sheet "${sheet}" has no header row; row 1 must name the columns.`);

  const headerIndex = new Map<string, number>();
  headers.forEach((name, index) => {
    const key = normalize(name);
    if (key && !headerIndex.has(key)) headerIndex.set(key, index);
  });
  const matchIndex = headerIndex.get(normalize(matchKey));
  if (matchIndex === undefined) {
    return fail(`Match column "${matchKey}" is not present in "${sheet}". Columns: ${headers.join(", ")}.`);
  }

  const lastColumn = columnLetter(headers.length - 1);
  const unknownColumns = Object.keys(input.row).filter((key) => !headerIndex.has(normalize(key)));

  // 2. Existing rows, so an update merges instead of blanking untouched columns.
  const dataCall = await sheetsRequest(
    valuesUrl(spreadsheetId, sheetRange(sheet, `A2:${lastColumn}`), "", "?majorDimension=ROWS"),
    token.token,
    { method: "GET" },
  );
  if ("error" in dataCall) return fail(dataCall.error);
  const dataBody = await readJsonBody<ValueRange>(dataCall.response);
  if (!dataCall.response.ok) {
    return fail(`Google Sheets returned HTTP ${dataCall.response.status} reading "${sheet}": ${extractErrorMessage(dataBody, "no error detail")}.`);
  }
  const rows = (dataBody.json?.values ?? []).map((row) => row.map(cellText));
  const target = matchValue.toLowerCase();
  const existingOffset = rows.findIndex((row) => cellText(row[matchIndex]).trim().toLowerCase() === target);

  const supplied = new Map<string, string>();
  for (const [key, value] of Object.entries(input.row)) supplied.set(normalize(key), cellText(value));

  const existingRow = existingOffset >= 0 ? rows[existingOffset] : [];
  const values = headers.map((name, index) => {
    const key = normalize(name);
    if (supplied.has(key)) return supplied.get(key) ?? "";
    return cellText(existingRow[index]);
  });
  values[matchIndex] = matchValue;

  const unknownNote = unknownColumns.length
    ? ` Unwritten columns not present in the sheet: ${unknownColumns.join(", ")}.`
    : "";

  // 3. Exactly one write.
  if (existingOffset >= 0) {
    const rowNumber = existingOffset + 2; // row 1 is the header
    const range = sheetRange(sheet, `A${rowNumber}:${lastColumn}${rowNumber}`);
    const call = await sheetsRequest(
      valuesUrl(spreadsheetId, range, "", "?valueInputOption=RAW"),
      token.token,
      { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: [values] }) },
    );
    if ("error" in call) return fail(call.error);
    const body = await readJsonBody<UpdateResponse>(call.response);
    if (!call.response.ok) {
      return fail(`Google Sheets returned HTTP ${call.response.status} updating row ${rowNumber}: ${extractErrorMessage(body, "no error detail")}.`);
    }
    return {
      ok: true,
      status: "written",
      provider: PROVIDER,
      detail: `Updated existing "${matchKey}" row ${rowNumber} in "${sheet}".${unknownNote}`,
      data: {
        spreadsheetId,
        sheet,
        operation: "updated",
        rowNumber,
        updatedRange: body.json?.updatedRange,
        unknownColumns,
        idempotencyKey: input.idempotencyKey,
      },
      externalUrl: spreadsheetUrl,
    };
  }

  const appendCall = await sheetsRequest(
    valuesUrl(
      spreadsheetId,
      sheetRange(sheet, `A1:${lastColumn}1`),
      ":append",
      "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    ),
    token.token,
    { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: [values] }) },
  );
  if ("error" in appendCall) return fail(appendCall.error);
  const appendBody = await readJsonBody<AppendResponse>(appendCall.response);
  if (!appendCall.response.ok) {
    return fail(`Google Sheets returned HTTP ${appendCall.response.status} appending to "${sheet}": ${extractErrorMessage(appendBody, "no error detail")}.`);
  }
  const updatedRange = appendBody.json?.updates?.updatedRange;
  return {
    ok: true,
    status: "written",
    provider: PROVIDER,
    detail: `Appended a new row for "${matchKey}" = ${matchValue} in "${sheet}".${unknownNote}`,
    data: {
      spreadsheetId,
      sheet,
      operation: "appended",
      rowNumber: rowNumberOf(updatedRange),
      updatedRange,
      unknownColumns,
      idempotencyKey: input.idempotencyKey,
    },
    externalUrl: spreadsheetUrl,
  };
}
