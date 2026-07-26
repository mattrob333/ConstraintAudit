import {
  googleDriveConfigured,
  googleSheetsConfigured,
  missingGoogleSheetsVars,
  missingGoogleVars,
  missingResendVars,
  resendConfigured,
} from "./env";
import type { IntegrationRuntimeStatus } from "./types";

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
 */
export function integrationRuntimeStatus(): IntegrationRuntimeStatus[] {
  return [
    {
      id: "resend",
      configured: resendConfigured(),
      capability: "send_approved_email",
      missing: missingResendVars(),
    },
    {
      id: "google_sheets",
      configured: googleSheetsConfigured(),
      capability: "append_or_update_crm_row",
      missing: missingGoogleSheetsVars(),
    },
    {
      id: "google_drive_docs",
      configured: googleDriveConfigured(),
      capability: "create_google_doc",
      missing: missingGoogleVars(),
    },
  ];
}
