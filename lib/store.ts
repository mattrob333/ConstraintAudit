import { getD1 } from "@/db";
import { legacyOwnerEmail, ownerIdForEmail } from "./auth";
import {
  CLIENT_SOURCES,
  CLIENT_STATUSES,
  type ClientDraft,
  type ClientRecord,
  type ClientSource,
  type ClientStatus,
} from "./clients";
import {
  HEADCOUNT_BANDS,
  BASELINE_STATUSES,
  CRM_STAGES,
  CRM_STATUSES,
  READINESS_STATUSES,
  WORKFLOW_STATES,
  assertWorkflowTransition,
  firmographicsAreEmpty,
  isOneOf,
  makeId,
  normalizeFirmographics,
  stageForState,
  type BaselineStatus,
  type CrmStage,
  type CrmStatus,
  type Engagement,
  type EngagementData,
  type FindingStatus,
  type Firmographics,
  type HeadcountBand,
  type ReadinessStatus,
  type WorkflowState,
} from "./workflow";

type D1 = ReturnType<typeof getD1>;
export type DbRow = Record<string, unknown>;

export const INTENT_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
  "executing",
  "executed",
  "failed",
] as const;

export type IntentStatus = (typeof INTENT_STATUSES)[number];

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS engagements (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL, website TEXT NOT NULL DEFAULT '',
    primary_contact TEXT NOT NULL DEFAULT '', primary_contact_role TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    advisor TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL, status TEXT NOT NULL,
    workflow_state TEXT NOT NULL, next_action TEXT NOT NULL, due_date TEXT,
    last_contact TEXT, call_1_at TEXT, call_2_at TEXT, readiness_brief_status TEXT NOT NULL,
    readiness_brief_sent_at TEXT, baseline_status TEXT NOT NULL,
    engagement_folder TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    finding_status TEXT NOT NULL DEFAULT 'none', data_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, provenance TEXT NOT NULL,
    source_url TEXT, content TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '',
    call_number INTEGER NOT NULL, source TEXT NOT NULL, source_id TEXT, source_url TEXT,
    title TEXT NOT NULL, raw_text TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL, activity_type TEXT NOT NULL, summary TEXT NOT NULL,
    outcome TEXT NOT NULL, next_action TEXT NOT NULL, owner TEXT NOT NULL,
    source_link TEXT, created_at TEXT NOT NULL
  )`,
  // `client_id` carries the roster-scoped intents (audit_invite). Exactly one of engagement_id
  // and client_id is set on any row; both columns stay NOT NULL DEFAULT '' so the reconcile path
  // can add client_id to a database that already holds engagement-scoped intents.
  `CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '',
    client_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    updated_at TEXT, executed_at TEXT
  )`,
  // The advisor's client roster — the front of the pipeline, before any engagement exists.
  // A proper table rather than a JSON blob: rows are searched, deduplicated on import, and
  // updated one at a time, which is exactly what every other owner-scoped table here does.
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL, website TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '', contact_role TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', industry TEXT NOT NULL DEFAULT '',
    headcount_band TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'none',
    engagement_id TEXT NOT NULL DEFAULT '', invited_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  // Per-owner, non-secret advisor configuration (CRM sheet id, tab, Drive folder, from-name).
  // Real credentials never live here — they stay in Cloudflare/wrangler secrets.
  `CREATE TABLE IF NOT EXISTS advisor_settings (
    owner_id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`,
  // Per-owner credential values saved from the app (see lib/secrets.ts). One row per field.
  // Secret fields hold an AES-GCM ciphertext plus its IV; non-secret fields hold a plain value
  // with an empty `iv`. `hint` is a display-only masked tail — never the value itself.
  `CREATE TABLE IF NOT EXISTS advisor_secrets (
    owner_id TEXT NOT NULL,
    field TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    hint TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, field)
  )`,
  // Deployment-wide, non-tenant key/value. Currently holds only the generated encryption key used
  // when no APP_ENCRYPTION_KEY binding is configured. Never owner-scoped, so it has no owner_id.
  `CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
] as const;

/**
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a deployed database, so every column added after the
 * first release has to be reconciled here as well. Keyed by table, then column name to type clause.
 */
const REQUIRED_COLUMNS: Record<string, Record<string, string>> = {
  engagements: {
    owner_id: "TEXT NOT NULL DEFAULT ''",
    primary_contact_role: "TEXT NOT NULL DEFAULT ''",
  },
  artifacts: { owner_id: "TEXT NOT NULL DEFAULT ''" },
  transcripts: { owner_id: "TEXT NOT NULL DEFAULT ''" },
  activities: { owner_id: "TEXT NOT NULL DEFAULT ''" },
  intents: {
    owner_id: "TEXT NOT NULL DEFAULT ''",
    client_id: "TEXT NOT NULL DEFAULT ''",
    result_json: "TEXT NOT NULL DEFAULT '{}'",
    updated_at: "TEXT",
    executed_at: "TEXT",
  },
  clients: {
    owner_id: "TEXT NOT NULL DEFAULT ''",
    website: "TEXT NOT NULL DEFAULT ''",
    contact_name: "TEXT NOT NULL DEFAULT ''",
    contact_role: "TEXT NOT NULL DEFAULT ''",
    email: "TEXT NOT NULL DEFAULT ''",
    industry: "TEXT NOT NULL DEFAULT ''",
    headcount_band: "TEXT NOT NULL DEFAULT ''",
    phone: "TEXT NOT NULL DEFAULT ''",
    source: "TEXT NOT NULL DEFAULT 'manual'",
    status: "TEXT NOT NULL DEFAULT 'none'",
    engagement_id: "TEXT NOT NULL DEFAULT ''",
    invited_at: "TEXT",
  },
  // owner_id is the PRIMARY KEY and always arrives with the CREATE, so only the value columns are
  // reconciled here. NOT NULL adds need a DEFAULT so ALTER succeeds on a table that already has rows.
  advisor_settings: {
    settings_json: "TEXT NOT NULL DEFAULT '{}'",
    updated_at: "TEXT NOT NULL DEFAULT ''",
  },
  // (owner_id, field) is the composite PRIMARY KEY and always arrives with the CREATE.
  advisor_secrets: {
    ciphertext: "TEXT NOT NULL DEFAULT ''",
    iv: "TEXT NOT NULL DEFAULT ''",
    hint: "TEXT NOT NULL DEFAULT ''",
    updated_at: "TEXT NOT NULL DEFAULT ''",
  },
  app_config: {
    value: "TEXT NOT NULL DEFAULT ''",
  },
};

const INDEX_STATEMENTS = [
  "CREATE INDEX IF NOT EXISTS idx_artifacts_engagement ON artifacts (engagement_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_transcripts_engagement ON transcripts (engagement_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activities_engagement ON activities (engagement_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_intents_engagement ON intents (engagement_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_engagements_owner ON engagements (owner_id, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts (owner_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_transcripts_owner ON transcripts (owner_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities (owner_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_intents_owner ON intents (owner_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_advisor_secrets_owner ON advisor_secrets (owner_id)",
  "CREATE INDEX IF NOT EXISTS idx_intents_client ON intents (client_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients (owner_id, updated_at DESC)",
] as const;

const CLEANUP_STATEMENTS = [
  "DELETE FROM artifacts WHERE engagement_id = 'eng_demo_northstar'",
  "DELETE FROM transcripts WHERE engagement_id = 'eng_demo_northstar'",
  "DELETE FROM activities WHERE engagement_id = 'eng_demo_northstar'",
  "DELETE FROM intents WHERE engagement_id = 'eng_demo_northstar'",
  "DELETE FROM engagements WHERE id = 'eng_demo_northstar'",
] as const;

let initialization: Promise<void> | null = null;

function text(row: DbRow, key: string): string {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function nullableText(row: DbRow, key: string): string | null {
  return typeof row[key] === "string" && row[key] ? row[key] as string : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Every scoped query binds this value. A blank owner is rejected rather than matched, otherwise the
 * `DEFAULT ''` backfill column would act as a wildcard for callers that forgot to pass a principal.
 */
function requireOwner(ownerId: string): string {
  const owner = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!owner) throw new Error("ownerId is required");
  return owner;
}

/** Shallow-merge engagement data, ignoring keys whose patch value is `undefined`. */
function mergeData(existing: EngagementData, patch: EngagementData): EngagementData {
  const merged: EngagementData = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function mapEngagement(row: DbRow): Engagement {
  return {
    id: text(row, "id"),
    ownerId: text(row, "owner_id"),
    client: text(row, "client"),
    website: text(row, "website"),
    primaryContact: text(row, "primary_contact"),
    primaryContactRole: text(row, "primary_contact_role"),
    email: text(row, "email"),
    advisor: text(row, "advisor"),
    stage: text(row, "stage") as CrmStage,
    status: text(row, "status") as CrmStatus,
    workflowState: text(row, "workflow_state") as WorkflowState,
    nextAction: text(row, "next_action"),
    dueDate: nullableText(row, "due_date"),
    lastContact: nullableText(row, "last_contact"),
    call1At: nullableText(row, "call_1_at"),
    call2At: nullableText(row, "call_2_at"),
    readinessBriefStatus: text(row, "readiness_brief_status") as ReadinessStatus,
    readinessBriefSentAt: nullableText(row, "readiness_brief_sent_at"),
    baselineStatus: text(row, "baseline_status") as BaselineStatus,
    engagementFolder: text(row, "engagement_folder"),
    notes: text(row, "notes"),
    findingStatus: text(row, "finding_status") as FindingStatus,
    data: parseJson<EngagementData>(row.data_json, {}),
    version: Number(row.version ?? 1),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function engagementInsert(db: D1, engagement: Engagement) {
  return db.prepare(
    `INSERT OR IGNORE INTO engagements (
      id, owner_id, client, website, primary_contact, primary_contact_role, email, advisor, stage, status,
      workflow_state, next_action, due_date, last_contact, call_1_at, call_2_at,
      readiness_brief_status, readiness_brief_sent_at, baseline_status,
      engagement_folder, notes, finding_status, data_json, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    engagement.id, engagement.ownerId, engagement.client, engagement.website,
    engagement.primaryContact, engagement.primaryContactRole, engagement.email, engagement.advisor, engagement.stage,
    engagement.status, engagement.workflowState, engagement.nextAction, engagement.dueDate,
    engagement.lastContact, engagement.call1At, engagement.call2At,
    engagement.readinessBriefStatus, engagement.readinessBriefSentAt, engagement.baselineStatus,
    engagement.engagementFolder, engagement.notes, engagement.findingStatus,
    JSON.stringify(engagement.data), engagement.version, engagement.createdAt, engagement.updatedAt,
  );
}

/**
 * Adds columns that predate the current schema on an already-deployed database. Table and column
 * names come from module constants only — SQLite cannot parameterise DDL identifiers.
 */
async function reconcileColumns(db: D1): Promise<string[]> {
  const altered: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<DbRow>();
    const rows = info.results ?? [];
    // No pragma support or no such table: the CREATE batch above is already authoritative.
    if (!rows.length) continue;
    const present = new Set(rows.map((row) => text(row, "name")));
    const missing = Object.entries(columns).filter(([name]) => !present.has(name));
    if (!missing.length) continue;
    await db.batch(
      missing.map(([name, type]) => db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)),
    );
    if (missing.some(([name]) => name === "owner_id")) altered.push(table);
  }
  return altered;
}

/**
 * Rows written before tenancy existed belong to the single advisor who created them. Claim them for
 * `LEGACY_OWNER_EMAIL` (falling back to the local advisor) so the migration orphans nothing; set
 * that binding to the real advisor address before enabling REQUIRE_ADVISOR_AUTH.
 */
async function backfillOwners(db: D1, tables: string[]): Promise<void> {
  if (!tables.length) return;
  const ownerId = ownerIdForEmail(legacyOwnerEmail());
  await db.batch(
    tables.map((table) =>
      db.prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id = ''`).bind(ownerId)),
  );
}

export async function ensureDatabase(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    const db = getD1();
    await db.batch(TABLE_STATEMENTS.map((sql) => db.prepare(sql)));
    await backfillOwners(db, await reconcileColumns(db));
    await db.batch([...INDEX_STATEMENTS, ...CLEANUP_STATEMENTS].map((sql) => db.prepare(sql)));
  })().catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

export async function listEngagements(ownerId: string): Promise<Engagement[]> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const result = await getD1().prepare(
    "SELECT * FROM engagements WHERE owner_id = ? ORDER BY updated_at DESC, id ASC"
  ).bind(owner).all<DbRow>();
  return (result.results ?? []).map(mapEngagement);
}

/** Another owner's engagement is indistinguishable from a missing one. */
export async function getEngagement(id: string, ownerId: string): Promise<Engagement | null> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const row = await getD1().prepare(
    "SELECT * FROM engagements WHERE id = ? AND owner_id = ? LIMIT 1"
  ).bind(id, owner).first<DbRow>();
  return row ? mapEngagement(row) : null;
}

export interface CreateEngagementInput {
  client: string;
  website?: string;
  primaryContact?: string;
  primaryContactRole?: string;
  email?: string;
  advisor?: string;
  notes?: string;
  /** Optional advisor-stated context captured at intake. Stored under `data`, never as evidence. */
  firmographics?: Firmographics;
}

export async function createEngagement(
  input: CreateEngagementInput & { ownerId: string },
): Promise<Engagement> {
  await ensureDatabase();
  const owner = requireOwner(input.ownerId);
  const client = input.client?.trim();
  if (!client) throw new Error("client is required");
  const firmographics = normalizeFirmographics(input.firmographics);
  const now = new Date().toISOString();
  const engagement: Engagement = {
    id: makeId("eng"),
    ownerId: owner,
    client,
    website: input.website?.trim() ?? "",
    primaryContact: input.primaryContact?.trim() ?? "",
    primaryContactRole: input.primaryContactRole?.trim() ?? "",
    email: input.email?.trim() ?? "",
    advisor: input.advisor?.trim() || "Tier 4 Advisor",
    stage: "Client",
    status: "Not started",
    workflowState: "RECON_DRAFT",
    nextAction: "Research this business",
    dueDate: null,
    lastContact: null,
    call1At: null,
    call2At: null,
    readinessBriefStatus: "Not drafted",
    readinessBriefSentAt: null,
    baselineStatus: "Missing",
    engagementFolder: "",
    notes: input.notes?.trim() ?? "",
    findingStatus: "none",
    // An entirely blank firmographics block is not stored: "the advisor said nothing" and
    // "the advisor said nothing three times" are the same fact, and an empty object on the
    // record would later read as though something had been captured.
    data: firmographicsAreEmpty(firmographics)
      ? { sourceRegister: [] }
      : { sourceRegister: [], firmographics },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const db = getD1();
  await db.batch([
    engagementInsert(db, engagement),
    activityStatement(db, engagement, {
      activityType: "Intake",
      summary: "Created engagement",
      outcome: "Canonical engagement record created",
      nextAction: engagement.nextAction,
      owner: engagement.advisor,
    }),
  ]);
  return engagement;
}

export type EngagementPatch =
  & Partial<Omit<Engagement, "id" | "ownerId" | "createdAt" | "updatedAt" | "version">>
  & { expectedVersion?: number };

function validatePatch(existing: Engagement, patch: EngagementPatch): Engagement {
  const changes = { ...patch };
  delete changes.expectedVersion;
  const workflowState = patch.workflowState ?? existing.workflowState;
  const baselineStatus = patch.baselineStatus ?? existing.baselineStatus;
  const findingStatus = patch.findingStatus ?? existing.findingStatus;
  if (!isOneOf(WORKFLOW_STATES, workflowState)) throw new Error("Invalid workflowState");
  if (!isOneOf(BASELINE_STATUSES, baselineStatus)) throw new Error("Invalid baselineStatus");
  if (!["none", "provisional", "client-verified", "approved"].includes(findingStatus)) {
    throw new Error("Invalid findingStatus");
  }
  assertWorkflowTransition(existing.workflowState, workflowState, baselineStatus, findingStatus);
  const stage = patch.stage ?? (patch.workflowState ? stageForState(workflowState) : existing.stage);
  if (!isOneOf(CRM_STAGES, stage)) throw new Error("Invalid stage");
  const status = patch.status ?? existing.status;
  if (!isOneOf(CRM_STATUSES, status)) throw new Error("Invalid status");
  const readinessBriefStatus = patch.readinessBriefStatus ?? existing.readinessBriefStatus;
  if (!isOneOf(READINESS_STATUSES, readinessBriefStatus)) throw new Error("Invalid readinessBriefStatus");
  if (findingStatus === "approved" && baselineStatus !== "Confirmed") {
    throw new Error("An approved finding requires a confirmed baseline.");
  }
  return {
    ...existing,
    ...changes,
    id: existing.id,
    // Ownership is never patchable; engagements cannot be handed between advisors through the API.
    ownerId: existing.ownerId,
    client: patch.client?.trim() || existing.client,
    stage,
    status,
    workflowState,
    readinessBriefStatus,
    baselineStatus,
    findingStatus,
    // Merge, but never let an `undefined` value in the patch delete a stored key. A caller
    // that means to clear a field sets it to null or an empty value, not undefined — which is
    // usually an accidental `obj?.maybeMissing` that would otherwise erase confirmed evidence.
    data: patch.data ? mergeData(existing.data, patch.data) : existing.data,
    version: existing.version + 1,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateEngagement(
  id: string,
  patch: EngagementPatch,
  ownerId: string,
): Promise<Engagement> {
  const owner = requireOwner(ownerId);
  const existing = await getEngagement(id, owner);
  if (!existing) throw new Error("Engagement not found");
  if (patch.expectedVersion !== undefined && patch.expectedVersion !== existing.version) {
    throw new Error(`Version conflict: expected ${patch.expectedVersion}, current ${existing.version}`);
  }
  const updated = validatePatch(existing, patch);
  const result = await getD1().prepare(
    `UPDATE engagements SET
      client = ?, website = ?, primary_contact = ?, primary_contact_role = ?, email = ?, advisor = ?, stage = ?,
      status = ?, workflow_state = ?, next_action = ?, due_date = ?, last_contact = ?,
      call_1_at = ?, call_2_at = ?, readiness_brief_status = ?, readiness_brief_sent_at = ?,
      baseline_status = ?, engagement_folder = ?, notes = ?, finding_status = ?,
      data_json = ?, version = ?, updated_at = ?
     WHERE id = ? AND owner_id = ? AND version = ?`
  ).bind(
    updated.client, updated.website, updated.primaryContact, updated.primaryContactRole, updated.email, updated.advisor,
    updated.stage, updated.status, updated.workflowState, updated.nextAction, updated.dueDate,
    updated.lastContact, updated.call1At, updated.call2At, updated.readinessBriefStatus,
    updated.readinessBriefSentAt, updated.baselineStatus, updated.engagementFolder, updated.notes,
    updated.findingStatus, JSON.stringify(updated.data), updated.version, updated.updatedAt,
    updated.id, owner, existing.version,
  ).run();
  if (!result.meta.changes) throw new Error("Concurrent update conflict");
  return updated;
}

interface ActivityInput {
  activityType: string;
  summary: string;
  outcome?: string;
  nextAction?: string;
  owner?: string;
  sourceLink?: string | null;
}

function activityStatement(db: D1, engagement: Engagement, input: ActivityInput) {
  return db.prepare(
    `INSERT INTO activities
     (id, engagement_id, owner_id, client, activity_type, summary, outcome, next_action, owner, source_link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId("act"), engagement.id, requireOwner(engagement.ownerId), engagement.client,
    input.activityType, input.summary, input.outcome ?? "",
    input.nextAction ?? engagement.nextAction,
    input.owner ?? engagement.advisor, input.sourceLink ?? null, new Date().toISOString(),
  );
}

export async function addActivity(engagement: Engagement, input: ActivityInput): Promise<void> {
  await ensureDatabase();
  await activityStatement(getD1(), engagement, input).run();
}

export async function listActivities(
  ownerId: string,
  engagementId?: string,
  limit = 100,
): Promise<DbRow[]> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const db = getD1();
  const statement = engagementId
    ? db.prepare(
      "SELECT * FROM activities WHERE owner_id = ? AND engagement_id = ? ORDER BY created_at DESC LIMIT ?"
    ).bind(owner, engagementId, safeLimit)
    : db.prepare(
      "SELECT * FROM activities WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?"
    ).bind(owner, safeLimit);
  const result = await statement.all<DbRow>();
  return result.results ?? [];
}

export interface ArtifactInput {
  kind: string;
  title: string;
  status: string;
  provenance: string;
  sourceUrl?: string | null;
  content: string;
  data?: unknown;
}

export async function createArtifact(engagement: Engagement, input: ArtifactInput): Promise<DbRow> {
  await ensureDatabase();
  const now = new Date().toISOString();
  const artifact = {
    id: makeId("doc"),
    engagement_id: engagement.id,
    owner_id: requireOwner(engagement.ownerId),
    kind: input.kind,
    title: input.title,
    status: input.status,
    provenance: input.provenance,
    source_url: input.sourceUrl ?? null,
    content: input.content,
    data_json: JSON.stringify(input.data ?? {}),
    created_at: now,
    updated_at: now,
  };
  await getD1().prepare(
    `INSERT INTO artifacts
     (id, engagement_id, owner_id, kind, title, status, provenance, source_url, content, data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(...Object.values(artifact)).run();
  return { ...artifact, data: input.data ?? {} };
}

export async function listArtifacts(ownerId: string, engagementId?: string): Promise<DbRow[]> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const db = getD1();
  const statement = engagementId
    ? db.prepare(
      "SELECT * FROM artifacts WHERE owner_id = ? AND engagement_id = ? ORDER BY created_at DESC"
    ).bind(owner, engagementId)
    : db.prepare(
      "SELECT * FROM artifacts WHERE owner_id = ? ORDER BY created_at DESC"
    ).bind(owner);
  const result = await statement.all<DbRow>();
  return (result.results ?? []).map((row) => ({ ...row, data: parseJson(row.data_json, {}) }));
}

export async function getArtifact(id: string, ownerId: string): Promise<DbRow | null> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const row = await getD1().prepare(
    "SELECT * FROM artifacts WHERE id = ? AND owner_id = ? LIMIT 1"
  ).bind(id, owner).first<DbRow>();
  return row ? { ...row, data: parseJson(row.data_json, {}) } : null;
}

export async function createTranscript(
  engagement: Engagement,
  input: {
    callNumber: 1 | 2;
    source: "paste" | "fireflies" | "upload";
    sourceId?: string;
    sourceUrl?: string;
    title: string;
    rawText: string;
    data: unknown;
  },
): Promise<DbRow> {
  await ensureDatabase();
  const transcript = {
    id: makeId("tx"),
    engagement_id: engagement.id,
    owner_id: requireOwner(engagement.ownerId),
    call_number: input.callNumber,
    source: input.source,
    source_id: input.sourceId ?? null,
    source_url: input.sourceUrl ?? null,
    title: input.title,
    raw_text: input.rawText,
    data_json: JSON.stringify(input.data),
    created_at: new Date().toISOString(),
  };
  await getD1().prepare(
    `INSERT INTO transcripts
     (id, engagement_id, owner_id, call_number, source, source_id, source_url, title, raw_text, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(...Object.values(transcript)).run();
  return { ...transcript, data: input.data };
}

function mapIntent(row: DbRow): DbRow {
  return {
    ...row,
    payload: parseJson(row.payload_json, {}),
    result: parseJson(row.result_json, {}),
  };
}

/**
 * Remove an engagement and everything hanging off it. Used by Practice mode so an advisor
 * can reset the worked example to pristine. Scoped by owner like every other write.
 */
/**
 * Insert a fully-formed engagement, ids and all. Only Practice mode uses this: the worked
 * example is deterministic, so it cannot go through `createEngagement`'s generated id.
 */
export async function insertEngagement(engagement: Engagement): Promise<Engagement> {
  await ensureDatabase();
  requireOwner(engagement.ownerId);
  await engagementInsert(getD1(), engagement).run();
  return engagement;
}

export async function deleteEngagementCascade(id: string, ownerId: string): Promise<boolean> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const db = getD1();
  const existing = await db.prepare(
    "SELECT id FROM engagements WHERE id = ? AND owner_id = ? LIMIT 1"
  ).bind(id, owner).first<DbRow>();
  if (!existing) return false;
  await db.batch([
    db.prepare("DELETE FROM artifacts WHERE engagement_id = ? AND owner_id = ?").bind(id, owner),
    db.prepare("DELETE FROM transcripts WHERE engagement_id = ? AND owner_id = ?").bind(id, owner),
    db.prepare("DELETE FROM activities WHERE engagement_id = ? AND owner_id = ?").bind(id, owner),
    db.prepare("DELETE FROM intents WHERE engagement_id = ? AND owner_id = ?").bind(id, owner),
    db.prepare("DELETE FROM engagements WHERE id = ? AND owner_id = ?").bind(id, owner),
  ]);
  return true;
}

/**
 * Insert one intent, always `pending_review`. `engagementId` and `clientId` are alternatives:
 * an engagement-scoped intent carries the first, a roster-scoped one the second. Neither shape
 * can be created in any other status — approval is a separate, explicit write.
 */
async function insertIntent(
  ownerId: string,
  scope: { engagementId?: string; clientId?: string },
  type: string,
  payload: unknown,
): Promise<DbRow> {
  await ensureDatabase();
  const now = new Date().toISOString();
  const intent = {
    id: makeId("intent"),
    engagement_id: scope.engagementId ?? "",
    owner_id: requireOwner(ownerId),
    client_id: scope.clientId ?? "",
    type,
    status: "pending_review" satisfies IntentStatus,
    payload_json: JSON.stringify(payload),
    result_json: "{}",
    created_at: now,
    updated_at: now,
    executed_at: null,
  };
  await getD1().prepare(
    `INSERT INTO intents
     (id, engagement_id, owner_id, client_id, type, status, payload_json, result_json, created_at, updated_at, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(...Object.values(intent)).run();
  return { ...intent, payload, result: {} };
}

export async function createIntent(
  engagement: Engagement,
  type: string,
  payload: unknown,
): Promise<DbRow> {
  return insertIntent(engagement.ownerId, { engagementId: engagement.id }, type, payload);
}

/**
 * A roster-scoped intent. The client pipeline exists before any engagement does, so an
 * invitation cannot hang off an engagement id — it hangs off the roster row instead.
 */
export async function createClientIntent(
  client: ClientRecord,
  type: string,
  payload: unknown,
): Promise<DbRow> {
  return insertIntent(client.ownerId, { clientId: client.id }, type, payload);
}

export async function getIntent(id: string, ownerId: string): Promise<DbRow | null> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const row = await getD1().prepare(
    "SELECT * FROM intents WHERE id = ? AND owner_id = ? LIMIT 1"
  ).bind(id, owner).first<DbRow>();
  return row ? mapIntent(row) : null;
}

/**
 * Roster-scoped intents for one advisor, newest first. Kept separate from `listIntents` so an
 * engagement's own action list never silently gains rows that belong to a different scope.
 */
export async function listClientIntents(ownerId: string, clientId?: string): Promise<DbRow[]> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const db = getD1();
  const statement = clientId
    ? db.prepare(
      "SELECT * FROM intents WHERE owner_id = ? AND client_id = ? ORDER BY created_at DESC"
    ).bind(owner, clientId)
    : db.prepare(
      "SELECT * FROM intents WHERE owner_id = ? AND client_id != '' ORDER BY created_at DESC"
    ).bind(owner);
  const result = await statement.all<DbRow>();
  return (result.results ?? []).map(mapIntent);
}

export async function listIntents(ownerId: string, engagementId?: string): Promise<DbRow[]> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const db = getD1();
  const statement = engagementId
    ? db.prepare(
      "SELECT * FROM intents WHERE owner_id = ? AND engagement_id = ? ORDER BY created_at DESC"
    ).bind(owner, engagementId)
    : db.prepare(
      "SELECT * FROM intents WHERE owner_id = ? ORDER BY created_at DESC"
    ).bind(owner);
  const result = await statement.all<DbRow>();
  return (result.results ?? []).map(mapIntent);
}

/**
 * Move an intent to a new status. When `expectedStatus` is given the update is a
 * compare-and-swap: the row changes only if it is still in that status, so two concurrent
 * requests cannot both claim the same intent. `changed` reports whether this call won.
 */
export async function updateIntentStatus(
  id: string,
  ownerId: string,
  status: string,
  result?: unknown,
  expectedStatus?: string,
): Promise<DbRow & { changed: boolean }> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  if (!(INTENT_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid intent status: ${status}`);
  }
  const now = new Date().toISOString();
  const terminal = status === "executed" || status === "failed";
  const outcome = await getD1().prepare(
    `UPDATE intents SET status = ?, updated_at = ?,
       executed_at = COALESCE(?, executed_at),
       result_json = COALESCE(?, result_json)
     WHERE id = ? AND owner_id = ?${expectedStatus ? " AND status = ?" : ""}`
  ).bind(...[
    status, now, terminal ? now : null,
    result === undefined ? null : JSON.stringify(result), id, owner,
    ...(expectedStatus ? [expectedStatus] : []),
  ]).run();
  const changed = Boolean(outcome.meta.changes);
  if (!changed && !expectedStatus) throw new Error("Intent not found");
  const updated = await getIntent(id, owner);
  if (!updated) throw new Error("Intent not found");
  return { ...updated, changed };
}

/**
 * Raw per-owner settings JSON. Returns `"{}"` for an advisor who has never saved settings, so the
 * caller (lib/settings.ts) applies its own defaults. Scoped by owner like every other read.
 */
export async function getSettingsRow(ownerId: string): Promise<string> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const row = await getD1().prepare(
    "SELECT settings_json FROM advisor_settings WHERE owner_id = ? LIMIT 1"
  ).bind(owner).first<DbRow>();
  return typeof row?.settings_json === "string" ? row.settings_json : "{}";
}

/** Upsert the per-owner settings JSON. `json` is already validated/serialised by lib/settings.ts. */
export async function putSettingsRow(ownerId: string, json: string): Promise<void> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  await getD1().prepare(
    `INSERT INTO advisor_settings (owner_id, settings_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`
  ).bind(owner, json, new Date().toISOString()).run();
}

/**
 * Saved credential rows for one advisor. Storage only: this layer never encrypts, decrypts, or
 * inspects a value — lib/secrets.ts owns the format of `ciphertext`/`iv`/`hint`. Owner-scoped like
 * every other read, so one advisor can never enumerate another's credentials.
 */
export async function listSecretRows(ownerId: string): Promise<DbRow[]> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const result = await getD1().prepare(
    "SELECT * FROM advisor_secrets WHERE owner_id = ? ORDER BY field ASC"
  ).bind(owner).all<DbRow>();
  return result.results ?? [];
}

/** Another owner's credential row is indistinguishable from a missing one. */
export async function getSecretRow(ownerId: string, field: string): Promise<DbRow | null> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const row = await getD1().prepare(
    "SELECT * FROM advisor_secrets WHERE owner_id = ? AND field = ? LIMIT 1"
  ).bind(owner, field).first<DbRow>();
  return row ?? null;
}

/** Upsert one credential row. Values are already encrypted (or deliberately plain) by the caller. */
export async function putSecretRow(
  ownerId: string,
  field: string,
  ciphertext: string,
  iv: string,
  hint: string,
): Promise<void> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  await getD1().prepare(
    `INSERT INTO advisor_secrets (owner_id, field, ciphertext, iv, hint, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, field) DO UPDATE SET
       ciphertext = excluded.ciphertext, iv = excluded.iv,
       hint = excluded.hint, updated_at = excluded.updated_at`
  ).bind(owner, field, ciphertext, iv, hint, new Date().toISOString()).run();
}

/** `false` when the advisor had nothing saved for that field. */
export async function deleteSecretRow(ownerId: string, field: string): Promise<boolean> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const result = await getD1().prepare(
    "DELETE FROM advisor_secrets WHERE owner_id = ? AND field = ?"
  ).bind(owner, field).run();
  return Boolean(result.meta.changes);
}

/**
 * Deployment-wide configuration value, `""` when unset. Not owner-scoped by design: the only
 * current entry is the generated encryption key, which is a property of the deployment, not of
 * an advisor. Never expose these values through an owner-facing route.
 */
export async function getAppConfig(key: string): Promise<string> {
  await ensureDatabase();
  const row = await getD1().prepare(
    "SELECT value FROM app_config WHERE key = ? LIMIT 1"
  ).bind(key).first<DbRow>();
  return text(row ?? {}, "value");
}

/* ===========================================================================
 * CLIENT ROSTER
 * ---------------------------------------------------------------------------
 * The pipeline's front door. Stored as its own owner-scoped table rather than a
 * per-owner JSON blob, because a roster is searched, deduplicated on import, and
 * patched one row at a time — the same access pattern every other table here has.
 * A blob would force a read-modify-write of the whole roster for a single status
 * change, and would lose the row-level tenancy that `owner_id` gives for free.
 * =========================================================================== */

function mapClient(row: DbRow): ClientRecord {
  const source = text(row, "source");
  const status = text(row, "status");
  const band = text(row, "headcount_band");
  return {
    id: text(row, "id"),
    ownerId: text(row, "owner_id"),
    company: text(row, "company"),
    website: text(row, "website"),
    contactName: text(row, "contact_name"),
    contactRole: text(row, "contact_role"),
    email: text(row, "email"),
    industry: text(row, "industry"),
    // An unreadable stored band reads as "not stated" rather than as the nearest real band.
    headcountBand: (HEADCOUNT_BANDS as readonly string[]).includes(band) ? band as HeadcountBand : "",
    phone: text(row, "phone"),
    source: (CLIENT_SOURCES as readonly string[]).includes(source) ? source as ClientSource : "manual",
    status: (CLIENT_STATUSES as readonly string[]).includes(status) ? status as ClientStatus : "none",
    engagementId: text(row, "engagement_id"),
    invitedAt: nullableText(row, "invited_at"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

export async function listClients(ownerId: string): Promise<ClientRecord[]> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const result = await getD1().prepare(
    "SELECT * FROM clients WHERE owner_id = ? ORDER BY updated_at DESC, company ASC"
  ).bind(owner).all<DbRow>();
  return (result.results ?? []).map(mapClient);
}

/** Another owner's client is indistinguishable from a missing one. */
export async function getClient(id: string, ownerId: string): Promise<ClientRecord | null> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const row = await getD1().prepare(
    "SELECT * FROM clients WHERE id = ? AND owner_id = ? LIMIT 1"
  ).bind(id, owner).first<DbRow>();
  return row ? mapClient(row) : null;
}

export async function createClient(ownerId: string, draft: ClientDraft): Promise<ClientRecord> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const company = draft.company?.trim();
  if (!company) throw new Error("company is required");
  const now = new Date().toISOString();
  const client: ClientRecord = {
    id: makeId("cli"),
    ownerId: owner,
    company,
    website: draft.website?.trim() ?? "",
    contactName: draft.contactName?.trim() ?? "",
    contactRole: draft.contactRole?.trim() ?? "",
    email: draft.email?.trim() ?? "",
    industry: draft.industry?.trim() ?? "",
    headcountBand: draft.headcountBand ?? "",
    phone: draft.phone?.trim() ?? "",
    source: draft.source === "csv" ? "csv" : "manual",
    status: "none",
    engagementId: "",
    invitedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await getD1().prepare(
    `INSERT INTO clients
     (id, owner_id, company, website, contact_name, contact_role, email, industry,
      headcount_band, phone, source, status, engagement_id, invited_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    client.id, client.ownerId, client.company, client.website, client.contactName,
    client.contactRole, client.email, client.industry, client.headcountBand, client.phone,
    client.source, client.status, client.engagementId, client.invitedAt,
    client.createdAt, client.updatedAt,
  ).run();
  return client;
}

export type ClientPatch = Partial<
  Pick<
    ClientRecord,
    "company" | "website" | "contactName" | "contactRole" | "email" | "industry"
    | "headcountBand" | "phone" | "status" | "engagementId" | "invitedAt"
  >
>;

const CLIENT_PATCH_COLUMNS: Array<[keyof ClientPatch, string]> = [
  ["company", "company"], ["website", "website"], ["contactName", "contact_name"],
  ["contactRole", "contact_role"], ["email", "email"], ["industry", "industry"],
  ["headcountBand", "headcount_band"], ["phone", "phone"], ["status", "status"],
  ["engagementId", "engagement_id"], ["invitedAt", "invited_at"],
];

/**
 * Patch one roster row. Only keys present in the patch are written, so a partial update from a
 * CSV import can never blank a field the file simply did not carry a column for.
 */
export async function updateClient(
  id: string,
  ownerId: string,
  patch: ClientPatch,
): Promise<ClientRecord> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const columns: string[] = [];
  const values: Array<string | null> = [];
  for (const [key, column] of CLIENT_PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (key === "status" && !(CLIENT_STATUSES as readonly string[]).includes(String(value))) {
      throw new Error(`Invalid client status: ${String(value)}`);
    }
    if (key === "headcountBand" && !(HEADCOUNT_BANDS as readonly string[]).includes(String(value))) {
      throw new Error(`Invalid headcount band: ${String(value)}`);
    }
    columns.push(`${column} = ?`);
    values.push(value === null ? null : String(value).trim());
  }
  if (columns.length) {
    const now = new Date().toISOString();
    const result = await getD1().prepare(
      `UPDATE clients SET ${columns.join(", ")}, updated_at = ? WHERE id = ? AND owner_id = ?`
    ).bind(...values, now, id, owner).run();
    if (!result.meta.changes) throw new Error("Client not found");
  }
  const updated = await getClient(id, owner);
  if (!updated) throw new Error("Client not found");
  return updated;
}

export async function deleteClient(id: string, ownerId: string): Promise<boolean> {
  await ensureDatabase();
  const owner = requireOwner(ownerId);
  const db = getD1();
  const result = await db.prepare(
    "DELETE FROM clients WHERE id = ? AND owner_id = ?"
  ).bind(id, owner).run();
  if (!result.meta.changes) return false;
  await db.prepare("DELETE FROM intents WHERE client_id = ? AND owner_id = ?").bind(id, owner).run();
  return true;
}

/**
 * An activity row for a roster action. `engagement_id` is empty because no engagement exists
 * yet; the row still carries the company so the advisor's audit trail stays continuous from
 * first import through to the engagement that follows.
 */
export async function addClientActivity(
  client: ClientRecord,
  input: ActivityInput,
): Promise<void> {
  await ensureDatabase();
  await getD1().prepare(
    `INSERT INTO activities
     (id, engagement_id, owner_id, client, activity_type, summary, outcome, next_action, owner, source_link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId("act"), "", requireOwner(client.ownerId), client.company,
    input.activityType, input.summary, input.outcome ?? "", input.nextAction ?? "",
    input.owner ?? "", input.sourceLink ?? null, new Date().toISOString(),
  ).run();
}

export async function putAppConfig(key: string, value: string): Promise<void> {
  await ensureDatabase();
  await getD1().prepare(
    `INSERT INTO app_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}
