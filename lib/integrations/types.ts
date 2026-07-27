import type { Credentials } from "../secrets";

/**
 * Shared shapes for deployed-app integration adapters.
 *
 * An adapter never decides whether it may act. It receives an already-approved
 * payload, performs exactly one external write, and reports what happened.
 *
 * Every adapter input carries an optional `credentials`, resolved for one advisor.
 * Omitted, the adapter reads the Cloudflare environment exactly as it always has.
 */

/** Credentials resolved for one advisor. Values are read, never stored or echoed. */
export interface WithCredentials {
  credentials?: Credentials;
}

export type AdapterStatus = "sent" | "written" | "created" | "not-configured" | "failed";

export interface AdapterResult<T = unknown> {
  ok: boolean;
  status: AdapterStatus;
  provider: string;
  detail: string;
  data?: T;
  externalUrl?: string;
}

/** Resend */

export interface SendEmailInput extends WithCredentials {
  to: string | readonly string[];
  subject: string;
  /** Plain-text/Markdown body. Always sent as the `text` part. */
  markdownBody: string;
  /** Optional pre-rendered HTML. When absent a minimal local conversion is used. */
  htmlBody?: string;
  /** Derived from the approved send intent. Resend dedupes on it for 24 hours. */
  idempotencyKey?: string;
}

export interface SendEmailData {
  id: string;
  to: string[];
  idempotencyKey?: string;
}

/** Google Sheets */

/** Anything a caller can hand a cell. Everything is written as a RAW string. */
export type CellValue = string | number | boolean | null | undefined;

export interface AppendOrUpdateRowInput extends WithCredentials {
  /** Defaults to GOOGLE_SHEETS_ID. */
  spreadsheetId?: string;
  /** Tab name, e.g. "Engagements". */
  sheet: string;
  /** Header column whose value identifies an existing row. */
  matchKey: string;
  /** Column-name -> cell value. Ordered against the live header row on write. */
  row: Readonly<Record<string, CellValue>>;
  /** Value to match in `matchKey`. Defaults to `row[matchKey]`. */
  matchValue?: string;
  /** Recorded for audit; Sheets has no idempotency header, the match key is the guard. */
  idempotencyKey?: string;
}

export interface AppendOrUpdateRowData {
  spreadsheetId: string;
  sheet: string;
  operation: "appended" | "updated";
  /** 1-based sheet row, when the API reported one. */
  rowNumber?: number;
  updatedRange?: string;
  /** Supplied keys that matched no header column and were not written. */
  unknownColumns: string[];
  idempotencyKey?: string;
}

/** Google Docs (via Drive upload + conversion) */

export interface CreateDocumentInput extends WithCredentials {
  title: string;
  /** Converted locally with a minimal renderer when `html` is absent. */
  markdown?: string;
  /** Pre-rendered HTML; takes precedence over `markdown`. */
  html?: string;
  /** Defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID; omitted entirely when neither is set. */
  folderId?: string;
}

export interface CreateDocumentData {
  id: string;
  name: string;
  webViewLink?: string;
  folderId?: string;
}

/** Runtime status reporting */

export interface IntegrationRuntimeStatus {
  id: string;
  configured: boolean;
  capability: string;
  /** Names only. Never values. */
  missing: string[];
}
