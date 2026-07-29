import {
  HEADCOUNT_BANDS,
  isOneOf,
  type Firmographics,
  type HeadcountBand,
} from "./workflow";

/**
 * The advisor's client roster: the front door to the pipeline, kept deliberately separate from
 * engagements. A roster row is a company the advisor might work with; an engagement is a
 * Throughput Audit actually under way. Nothing in this file performs a network call — composing
 * an invitation and queueing it are offline operations by construction, and the only code that
 * may contact a provider is the adapter reached from an approved intent.
 */

export const CLIENT_SOURCES = ["csv", "manual"] as const;
export const CLIENT_STATUSES = ["none", "invited", "engaged"] as const;

export type ClientSource = (typeof CLIENT_SOURCES)[number];
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface ClientRecord {
  id: string;
  /** Owning advisor principal. Every read and write is scoped to this value. */
  ownerId: string;
  company: string;
  website: string;
  contactName: string;
  contactRole: string;
  email: string;
  industry: string;
  headcountBand: HeadcountBand;
  phone: string;
  source: ClientSource;
  status: ClientStatus;
  /** Set when an audit is started from this row, so the roster can link to the engagement. */
  engagementId: string;
  /** Set only after an invite intent has actually been executed. Never on queueing. */
  invitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Everything an import or the manual add row can supply. Status and linkage are server-owned. */
export type ClientDraft = Pick<
  ClientRecord,
  "company" | "website" | "contactName" | "contactRole" | "email" | "industry" | "headcountBand" | "phone" | "source"
>;

export function emptyClientDraft(source: ClientSource = "manual"): ClientDraft {
  return {
    company: "", website: "", contactName: "", contactRole: "",
    email: "", industry: "", headcountBand: "", phone: "", source,
  };
}

/* ===========================================================================
 * CSV import
 * =========================================================================== */

/** 1 MB. A roster export that exceeds this is a mistake, not a roster. */
export const MAX_CSV_BYTES = 1024 * 1024;

/** Every draft field a CSV column can land in, plus the two-column name split. */
export type CsvField = keyof ClientDraft | "firstName" | "lastName";

/**
 * Header aliases, keyed by the normalised header text (lowercased, non-alphanumerics stripped).
 * Zoho's Leads and Accounts exports are the reference vocabulary — "Account Name", "No of
 * Employees", "No. of Employees", and "Designation" all appear in real exports and all collapse
 * to the same normalised key, so one entry covers each spelling.
 */
export const CSV_HEADER_ALIASES: Record<string, CsvField> = {
  // company
  company: "company",
  companyname: "company",
  accountname: "company",
  account: "company",
  organization: "company",
  organisation: "company",
  businessname: "company",
  // contact name (whole, or split across two Zoho columns)
  contactname: "contactName",
  fullname: "contactName",
  name: "contactName",
  primarycontact: "contactName",
  firstname: "firstName",
  lastname: "lastName",
  // contact role
  title: "contactRole",
  designation: "contactRole",
  jobtitle: "contactRole",
  role: "contactRole",
  contactrole: "contactRole",
  // email
  email: "email",
  emailaddress: "email",
  primaryemail: "email",
  // website
  website: "website",
  weburl: "website",
  url: "website",
  domain: "website",
  // industry
  industry: "industry",
  sector: "industry",
  // headcount
  noofemployees: "headcountBand",
  numberofemployees: "headcountBand",
  employees: "headcountBand",
  employeecount: "headcountBand",
  headcount: "headcountBand",
  companysize: "headcountBand",
  // phone
  phone: "phone",
  phonenumber: "phone",
  telephone: "phone",
  mobile: "phone",
  workphone: "phone",
};

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Column index -> draft field. Unrecognised columns are simply absent, never guessed at. */
export function mapCsvHeaders(headers: readonly string[]): Map<number, CsvField> {
  const mapping = new Map<number, CsvField>();
  const claimed = new Set<CsvField>();
  headers.forEach((header, index) => {
    const field = CSV_HEADER_ALIASES[normalizeHeader(header)];
    // First matching column wins, so a trailing "Secondary Email" cannot overwrite "Email".
    if (!field || claimed.has(field)) return;
    claimed.add(field);
    mapping.set(index, field);
  });
  return mapping;
}

/**
 * Employee count -> band. An exact band string ("50-249") is honoured as written. A number is
 * placed in the band that contains it. A range ("11-50") is read from its low end, because that
 * is the only end the source actually asserts about the company's size. Anything unreadable —
 * including 0 and blank — becomes "", which means "not stated", never a guessed band.
 */
export function headcountBandFromEmployees(value: string): HeadcountBand {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (isOneOf(HEADCOUNT_BANDS, trimmed) && trimmed) return trimmed;
  // "250+", "1,000+", "500 +"
  const openEnded = /^([\d,]+)\s*\+$/.exec(trimmed);
  const source = openEnded ? openEnded[1] : trimmed;
  const digits = /-?\d[\d,]*/.exec(source);
  if (!digits) return "";
  const count = Number(digits[0].replace(/,/g, ""));
  if (!Number.isFinite(count) || count < 1) return "";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 250) return "50-249";
  return "250+";
}

/**
 * RFC 4180 reader: quoted fields may contain commas, newlines, and doubled quotes. Written out
 * rather than split(",") because a Zoho export routinely quotes an address or a job title that
 * contains a comma, and splitting one of those shifts every later column by one.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; started = false; };
  // Strip a UTF-8 BOM: Excel and Zoho both emit one, and it corrupts the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; continue; }
        quoted = false;
        continue;
      }
      field += char;
      continue;
    }
    if (char === '"' && !field.trim()) { quoted = true; started = true; continue; }
    if (char === ",") { pushField(); started = true; continue; }
    if (char === "\r") continue;
    if (char === "\n") { pushRow(); continue; }
    field += char;
    started = true;
  }
  if (started || field) pushRow();
  return rows.filter((entry) => entry.some((cell) => cell.trim()));
}

export interface ImportSkip {
  /** 1-based line number in the uploaded file, so the advisor can find the row. */
  line: number;
  reason: string;
}

export interface ImportSummary {
  imported: number;
  updated: number;
  skipped: ImportSkip[];
  /** Header text -> the roster field it was mapped onto. Shown so the mapping is inspectable. */
  mapped: Array<{ header: string; field: CsvField }>;
  /** Columns that matched nothing. Reported rather than silently dropped. */
  unmapped: string[];
  rowsRead: number;
}

export interface ImportPlan {
  creates: ClientDraft[];
  /** Existing roster rows to patch. `patch` carries only the values the file actually supplied. */
  updates: Array<{ id: string; patch: Partial<ClientDraft> }>;
  summary: ImportSummary;
}

/** Same company AND same email is the same client. Case- and whitespace-insensitive. */
export function clientKey(company: string, email: string): string {
  return `${company.trim().toLowerCase()} ${email.trim().toLowerCase()}`;
}

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/** Only non-empty values overwrite. A CSV column left blank must not erase a stored value. */
function patchFrom(draft: ClientDraft): Partial<ClientDraft> {
  const patch: Partial<ClientDraft> = {};
  if (draft.website) patch.website = draft.website;
  if (draft.contactName) patch.contactName = draft.contactName;
  if (draft.contactRole) patch.contactRole = draft.contactRole;
  if (draft.industry) patch.industry = draft.industry;
  if (draft.headcountBand) patch.headcountBand = draft.headcountBand;
  if (draft.phone) patch.phone = draft.phone;
  return patch;
}

/**
 * Turn an uploaded CSV into an explicit plan against the roster the advisor already has.
 *
 * Pure and offline: it reads text and existing rows, and returns what would change. It performs
 * no write and no network call. Rows with no company name are skipped and reported by line
 * number; a row matching an existing client (same company + email) updates that client rather
 * than creating a second copy of it.
 */
export function planClientImport(text: string, existing: readonly ClientRecord[]): ImportPlan {
  const rows = parseCsv(text);
  if (!rows.length) {
    return {
      creates: [], updates: [],
      summary: { imported: 0, updated: 0, skipped: [], mapped: [], unmapped: [], rowsRead: 0 },
    };
  }
  const [headerRow, ...dataRows] = rows;
  const mapping = mapCsvHeaders(headerRow);
  const mapped = [...mapping.entries()].map(([index, field]) => ({ header: clean(headerRow[index]), field }));
  const unmapped = headerRow
    .map((header, index) => (mapping.has(index) ? "" : clean(header)))
    .filter(Boolean);

  const byKey = new Map<string, ClientRecord>();
  for (const record of existing) byKey.set(clientKey(record.company, record.email), record);

  const creates: ClientDraft[] = [];
  const createIndex = new Map<string, number>();
  const updates: Array<{ id: string; patch: Partial<ClientDraft> }> = [];
  const updateIndex = new Map<string, number>();
  const skipped: ImportSkip[] = [];

  dataRows.forEach((cells, offset) => {
    // +2: one for the header row, one because advisors count lines from 1.
    const line = offset + 2;
    const draft = emptyClientDraft("csv");
    let firstName = "";
    let lastName = "";
    for (const [index, field] of mapping) {
      const value = clean(cells[index]);
      if (!value) continue;
      if (field === "firstName") { firstName = value; continue; }
      if (field === "lastName") { lastName = value; continue; }
      if (field === "headcountBand") { draft.headcountBand = headcountBandFromEmployees(value); continue; }
      if (field === "source") continue;
      draft[field] = value;
    }
    if (!draft.contactName) draft.contactName = clean(`${firstName} ${lastName}`);
    if (!draft.company) {
      skipped.push({ line, reason: "No company name in this row." });
      return;
    }
    const key = clientKey(draft.company, draft.email);
    const known = byKey.get(key);
    if (known) {
      const at = updateIndex.get(known.id);
      if (at === undefined) {
        updateIndex.set(known.id, updates.length);
        updates.push({ id: known.id, patch: patchFrom(draft) });
      } else {
        // The same client twice in one file: later values win, blanks still never erase.
        updates[at] = { id: known.id, patch: { ...updates[at].patch, ...patchFrom(draft) } };
      }
      return;
    }
    const pending = createIndex.get(key);
    if (pending === undefined) {
      createIndex.set(key, creates.length);
      creates.push(draft);
    } else {
      creates[pending] = { ...creates[pending], ...patchFrom(draft), company: draft.company, email: draft.email, source: "csv" };
    }
  });

  return {
    creates,
    updates,
    summary: {
      imported: creates.length,
      updated: updates.length,
      skipped,
      mapped,
      unmapped,
      rowsRead: dataRows.length,
    },
  };
}

/* ===========================================================================
 * Audit invitation
 * =========================================================================== */

/** The firmographics an audit inherits when it is started from a roster row. */
export function firmographicsFromClient(client: Pick<ClientRecord, "industry" | "headcountBand">): Firmographics {
  return { industry: client.industry, headcountBand: client.headcountBand, businessModel: "" };
}

/** "Maya Chen" -> "Maya". Falls back to nothing rather than to a placeholder name. */
function firstNameOf(contactName: string): string {
  return contactName.trim().split(/\s+/)[0] ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface AuditInviteEmail {
  subject: string;
  /** A real plain-text body, not markdown that happens to be readable. */
  text: string;
  html: string;
}

/**
 * The invitation.
 *
 * Deliberately plain: it says who is writing, what a throughput audit is, and that the advisor
 * will follow up. It makes no claim about the recipient's business, promises no result, quotes
 * no benchmark, and carries no tracking pixel, no image, and no link. Every sentence here is
 * about the method, which is the only thing that is known at this point in the pipeline.
 */
export function buildAuditInviteEmail(input: {
  company: string;
  contactName: string;
  advisorName: string;
}): AuditInviteEmail {
  const company = input.company.trim() || "your business";
  const advisor = input.advisorName.trim() || "Tier 4 Advisor";
  const first = firstNameOf(input.contactName);
  const greeting = first ? `Hi ${first},` : "Hello,";
  const paragraphs = [
    `I'm ${advisor}. I'd like to run a throughput audit with ${company}.`,
    "A throughput audit is a short, evidence-based look at how work moves through a business. It ends with one thing: the single constraint that currently limits how much finished work gets out, a measured baseline for that constraint taken from your own numbers, and one named person who owns the change. It is not a general assessment, and it does not compare you to anyone else.",
    "I'll follow up shortly to find a time that suits you.",
  ];
  const text = [greeting, "", ...paragraphs.flatMap((line) => [line, ""]), advisor].join("\n");
  const html = [
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2a24;">',
    `<p>${escapeHtml(greeting)}</p>`,
    ...paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>${escapeHtml(advisor)}</p>`,
    "</div>",
  ].join("\n");
  return { subject: `Throughput audit for ${company}`, text, html };
}

/** The payload an `audit_invite` intent carries. Built offline; nothing here sends anything. */
export interface AuditInvitePayload {
  clientId: string;
  company: string;
  to: string;
  contactName: string;
  subject: string;
  /** Plain-text body. The Resend adapter sends this verbatim as the `text` part. */
  body: string;
  /** Pre-rendered HTML, so the send never derives HTML from markdown for this email. */
  htmlBody: string;
  requiresExplicitApproval: true;
}

/**
 * Compose the intent payload for one roster client. Pure: no store read, no credential lookup,
 * and no provider call. Creating the intent is a proposal; sending is a separate, approved act.
 */
export function buildAuditInvitePayload(
  client: Pick<ClientRecord, "id" | "company" | "contactName" | "email">,
  advisorName: string,
): AuditInvitePayload {
  const email = buildAuditInviteEmail({
    company: client.company,
    contactName: client.contactName,
    advisorName,
  });
  return {
    clientId: client.id,
    company: client.company,
    to: client.email.trim(),
    contactName: client.contactName,
    subject: email.subject,
    body: email.text,
    htmlBody: email.html,
    requiresExplicitApproval: true,
  };
}
