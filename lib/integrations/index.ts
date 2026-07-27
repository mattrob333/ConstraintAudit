import type { Credentials } from "../secrets";
import {
  googleDriveConfigured,
  googleSheetsConfigured,
  missingGoogleSheetsVars,
  missingGoogleVars,
  missingResendVars,
  resendConfigured,
} from "./env";
import type { IntegrationRuntimeStatus } from "./types";

/** Re-exported so callers can type an adapter's optional credentials without reaching into lib/secrets. */
export type { CredentialSource, Credentials } from "../secrets";

export type {
  AdapterResult,
  AdapterStatus,
  AppendOrUpdateRowData,
  AppendOrUpdateRowInput,
  CellValue,
  CreateDocumentData,
  CreateDocumentInput,
  IntegrationRuntimeStatus,
  SendEmailData,
  SendEmailInput,
  WithCredentials,
} from "./types";

export {
  googleConfigured,
  googleDriveConfigured,
  googleSheetsConfigured,
  resendConfigured,
} from "./env";

export { sendEmail } from "./resend";
export { appendOrUpdateRow } from "./google-sheets";
export { createDocument, markdownToHtml } from "./google-docs";
export { DRIVE_FILE_SCOPE, getAccessToken, resetAccessTokenCache } from "./google-oauth";

/**
 * Truthful per-provider runtime state for /api/integrations.
 * `configured` means the adapter can attempt a call, not that it is authorized to.
 * Approval gates live in the workflow layer, never here.
 *
 * With `credentials` the report describes what that advisor can do; without it, the
 * deployment environment alone. Only names are ever reported, never values.
 */
export function integrationRuntimeStatus(credentials?: Credentials): IntegrationRuntimeStatus[] {
  return [
    {
      id: "resend",
      configured: resendConfigured(credentials),
      capability: "send_approved_email",
      missing: missingResendVars(credentials),
    },
    {
      id: "google_sheets",
      configured: googleSheetsConfigured(credentials),
      capability: "append_or_update_crm_row",
      missing: missingGoogleSheetsVars(credentials),
    },
    {
      id: "google_drive_docs",
      configured: googleDriveConfigured(credentials),
      capability: "create_google_doc",
      missing: missingGoogleVars(credentials),
    },
  ];
}
