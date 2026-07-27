import { getSettingsRow, putSettingsRow } from "./store";

/**
 * Per-advisor, non-secret configuration.
 *
 * Nothing here is a credential. A Google Sheet id lives in the sheet's own URL, a Drive folder id in
 * the folder's URL, and a from-name is a display string. Real secrets (API keys, OAuth tokens) stay
 * in Cloudflare/wrangler secrets and are read only inside lib/integrations — never stored here.
 */
export interface AdvisorSettings {
  /** Spreadsheet id only, parsed out of a pasted Google Sheets URL or accepted as a bare id. */
  crmSpreadsheetId: string;
  /** CRM tab name. Defaults to "Engagements". */
  crmSheetTab: string;
  /** Optional Drive folder id for published documents. */
  driveFolderId: string;
  /** Optional display name for outgoing email. */
  fromName: string;
}

/**
 * Canonical CRM columns. Single source of truth for the downloadable template header (row 1), the
 * write-back row order in lib/actions.ts, and the column-coverage check in lib/integrations/verify.ts,
 * so the three can never silently drift apart.
 */
export const CRM_COLUMNS = [
  "Engagement ID",
  "Client",
  "Website",
  "Primary Contact",
  "Email",
  "Advisor",
  "Stage",
  "Status",
  "Next Action",
  "Due Date",
  "Last Contact",
  "Call 1",
  "Call 2",
  "Readiness Brief status",
  "Baseline status",
  "Engagement Folder",
  "Notes",
] as const;

/** The header column the write-back matches on to stay idempotent (update vs. append). */
export const CRM_MATCH_KEY = "Engagement ID";

/** Tab an advisor gets before they rename it. */
export const DEFAULT_CRM_SHEET_TAB = "Engagements";

const DEFAULT_SETTINGS: AdvisorSettings = {
  crmSpreadsheetId: "",
  crmSheetTab: DEFAULT_CRM_SHEET_TAB,
  driveFolderId: "",
  fromName: "",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Extract the id from a full Google Sheets URL or accept a bare id.
 *
 * `https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0` -> `<ID>`. A value that is already a bare
 * id (letters, digits, `-`, `_`) is returned as-is. Anything else yields "" rather than a guess.
 */
export function parseSpreadsheetId(input: string): string {
  const value = asString(input).trim();
  if (!value) return "";
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(value);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]+$/.test(value)) return value;
  // A URL in some other shape: take the longest id-like token, or give up.
  const token = /([a-zA-Z0-9-_]{20,})/.exec(value);
  return token ? token[1] : "";
}

/**
 * Extract a Drive folder id from a folder URL or accept a bare id.
 * `https://drive.google.com/drive/folders/<ID>` -> `<ID>`.
 */
export function parseDriveFolderId(input: string): string {
  const value = asString(input).trim();
  if (!value) return "";
  const fromUrl = /\/folders\/([a-zA-Z0-9-_]+)/.exec(value);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]+$/.test(value)) return value;
  const token = /([a-zA-Z0-9-_]{20,})/.exec(value);
  return token ? token[1] : "";
}

/** Coerce an arbitrary parsed object into a fully-defaulted, trimmed AdvisorSettings. */
function normalize(raw: unknown): AdvisorSettings {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    crmSpreadsheetId: parseSpreadsheetId(asString(source.crmSpreadsheetId)),
    crmSheetTab: asString(source.crmSheetTab).trim() || DEFAULT_CRM_SHEET_TAB,
    driveFolderId: parseDriveFolderId(asString(source.driveFolderId)),
    fromName: asString(source.fromName).trim(),
  };
}

/** Sane defaults for a new advisor; stored values are normalised on read. */
export async function getSettings(ownerId: string): Promise<AdvisorSettings> {
  const rawJson = await getSettingsRow(ownerId);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    parsed = {};
  }
  return normalize(parsed);
}

/**
 * Merge a partial patch onto the stored settings and persist. Only keys present in the patch change;
 * an absent key is left untouched. Ids are parsed (URL or bare) and every value is trimmed on write.
 */
export async function putSettings(
  ownerId: string,
  patch: Partial<AdvisorSettings>,
): Promise<AdvisorSettings> {
  const current = await getSettings(ownerId);
  const next: AdvisorSettings = { ...current };
  if (patch.crmSpreadsheetId !== undefined) {
    next.crmSpreadsheetId = parseSpreadsheetId(asString(patch.crmSpreadsheetId));
  }
  if (patch.crmSheetTab !== undefined) {
    next.crmSheetTab = asString(patch.crmSheetTab).trim() || DEFAULT_CRM_SHEET_TAB;
  }
  if (patch.driveFolderId !== undefined) {
    next.driveFolderId = parseDriveFolderId(asString(patch.driveFolderId));
  }
  if (patch.fromName !== undefined) {
    next.fromName = asString(patch.fromName).trim();
  }
  // Persist a defaulted object, never the caller's raw shape, so unknown keys never reach the DB.
  await putSettingsRow(ownerId, JSON.stringify({ ...DEFAULT_SETTINGS, ...next }));
  return next;
}
