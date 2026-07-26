export const WORKFLOW_STATES = [
  "RECON_DRAFT",
  "GUIDED_CANVAS_COMPLETE",
  "TRANSCRIPT_1_SYNTHESIZED",
  "CANVAS_COMMIT_APPROVED",
  "FINDINGS_CALL_COMPLETE",
  "TRANSCRIPT_2_RECONCILED",
  "DIAGNOSIS_APPROVED",
  "SPRINT_ACTIVE",
  "OUTCOME_MEASURED",
  "CATALOG_WRITTEN",
] as const;

export const CRM_STAGES = [
  "Client",
  "Research",
  "Prepare",
  "Call",
  "Synthesize",
  "Deliver",
  "Sprint & Catalog",
] as const;

export const CRM_STATUSES = [
  "Not started",
  "In progress",
  "Waiting on client",
  "Needs review",
  "Approved",
  "Closed",
] as const;

export const CANVAS_BLOCKS = [
  "Customer Segments",
  "Value Propositions",
  "Channels",
  "Customer Relationships",
  "Revenue Streams",
  "Key Resources",
  "Key Activities",
  "Key Partners",
  "Cost Structure",
] as const;

/**
 * Historic documents and older records used "Key Partnerships" for the block the
 * research schema calls "Key Partners". Normalize so one canonical Canvas exists.
 */
const CANVAS_BLOCK_ALIASES: Record<string, CanvasBlock> = {
  "key partnerships": "Key Partners",
  "key partner": "Key Partners",
  "customer segment": "Customer Segments",
  "value proposition": "Value Propositions",
  "channel": "Channels",
  "customer relationship": "Customer Relationships",
  "revenue stream": "Revenue Streams",
  "key resource": "Key Resources",
  "key activity": "Key Activities",
  "key activities": "Key Activities",
};

export const DISCOVERY_SECTIONS = [
  "demand",
  "promise",
  "flow",
  "constraint",
  "baseline",
  "roles",
  "feasibility",
] as const;

/**
 * Every externally-visible action the app can propose. An intent is always created in
 * `pending_review` and requires a separate explicit approval before it may be executed.
 */
export const INTENT_TYPES = [
  "readiness_brief_send",
  "crm_write_back",
  "document_publish",
] as const;

export const INTENT_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
  "executed",
  "failed",
] as const;

export const BASELINE_STATUSES = ["Missing", "Partial", "Confirmed"] as const;
export const READINESS_STATUSES = ["Not drafted", "Drafted", "Approved", "Sent"] as const;
export const CONSTRAINT_TYPES = ["capacity", "latency", "quality", "knowledge", "policy"] as const;
export const PROVENANCE = ["client-stated", "doc", "public-research", "advisor-note", "gap"] as const;

export type IntentType = (typeof INTENT_TYPES)[number];
export type IntentStatus = (typeof INTENT_STATUSES)[number];
export type CanvasBlock = (typeof CANVAS_BLOCKS)[number];
export type DiscoverySection = (typeof DISCOVERY_SECTIONS)[number];
export type WorkflowState = (typeof WORKFLOW_STATES)[number];
export type CrmStage = (typeof CRM_STAGES)[number];
export type CrmStatus = (typeof CRM_STATUSES)[number];
export type BaselineStatus = (typeof BASELINE_STATUSES)[number];
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];
export type ConstraintType = (typeof CONSTRAINT_TYPES)[number];
export type Provenance = (typeof PROVENANCE)[number];
export type FindingStatus = "none" | "provisional" | "client-verified" | "approved";

export interface Engagement {
  id: string;
  /** Owning advisor principal. Every read and write is scoped to this value. */
  ownerId: string;
  client: string;
  website: string;
  primaryContact: string;
  email: string;
  advisor: string;
  stage: CrmStage;
  status: CrmStatus;
  workflowState: WorkflowState;
  nextAction: string;
  dueDate: string | null;
  lastContact: string | null;
  call1At: string | null;
  call2At: string | null;
  readinessBriefStatus: ReadinessStatus;
  readinessBriefSentAt: string | null;
  baselineStatus: BaselineStatus;
  engagementFolder: string;
  notes: string;
  findingStatus: FindingStatus;
  data: EngagementData;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EngagementData {
  sourceRegister?: SourceEntry[];
  research?: ResearchSynthesis;
  baseline?: BaselineMetric;
  finding?: ConstraintFinding;
  /** The single canonical Business Model Canvas. Written by research, corrected by transcripts. */
  canvas?: Record<CanvasBlock, EvidenceClaim[]> | Record<string, EvidenceClaim[]>;
  /** The traced value flow, seeded by research and confirmed or corrected on the call. */
  valueFlow?: ValueFlowStep[];
  roles?: RoleMapEntry[];
  transcriptSynthesis?: TranscriptSynthesis[];
  approvedReadinessBrief?: ApprovedReadinessBrief;
  recordingConsent?: Partial<Record<"call1" | "call2", ConsentAttestation>>;
  sprint?: SprintRecord;
  outcome?: OutcomeMeasurement;
  catalogEntry?: CatalogEntry;
  [key: string]: unknown;
}

/** A fixed-scope sprint activated after diagnosis approval. */
export interface SprintRecord {
  sprintId: string;
  constraintId: string;
  activatedAt: string;
  activatedBy: string;
  prescription: string;
  humanOwner: { name: string; role: string };
  startingMetric: BaselineMetric;
  measurementClockStartedAt: string;
  tasks: Array<{ id: string; task: string; owner: string; status: "todo" | "in_progress" | "done" }>;
}

/**
 * A before/after measurement. `delta` is only ever computed from two client-confirmed
 * numeric readings; it is never estimated, projected, or inferred.
 */
export interface OutcomeMeasurement {
  measuredAt: string;
  measuredBy: string;
  startingMetric: BaselineMetric;
  endingMetric: BaselineMetric;
  delta: { absolute: string; percent: string; direction: "improved" | "worsened" | "unchanged" } | null;
  deltaBlockedReason?: string;
  constraintMoved: boolean;
  nextConstraintObserved: string;
  evidence: Array<{ quote: string; source: string }>;
}

/** A reusable pattern written back to the catalog after a measured outcome. */
export interface CatalogEntry {
  entryId: string;
  constraintType: ConstraintType;
  canvasBlock: CanvasBlock | string;
  pattern: string;
  prescription: string;
  measuredResult: string;
  industryContext: string;
  reusableFor: string;
  writtenAt: string;
}

export interface ApprovedReadinessBrief {
  documentId: string;
  approvedAt: string;
  approvedBy: string;
}

export interface ConsentAttestation {
  grantedBeforeCapture: true;
  attestedBy: string;
  attestedAt: string;
  note?: string;
}

export interface SourceEntry {
  id: string;
  label: string;
  url?: string;
  provenance: Provenance;
  capturedAt: string;
}

export interface EvidenceClaim {
  statement: string;
  provenance: Provenance;
  confidence: number;
  sourceLabel: string;
  sourceUrl?: string;
  canvasBlock?: string;
}

export interface ConstraintHypothesis {
  canvasBlock: string;
  type: ConstraintType;
  evidenceHint: string;
  confirmationCondition: string;
  killCondition: string;
}

/**
 * One step in the company's traced value flow. Public research may only propose a
 * step; the client confirms or corrects it live. `evidenceStatus` never becomes
 * `client-stated` from research alone.
 */
export interface ValueFlowStep {
  id: string;
  order: number;
  name: string;
  description: string;
  input: string;
  output: string;
  actor: string;
  system: string;
  evidenceStatus: Extract<Provenance, "public-research" | "advisor-note" | "gap">;
  sourceUrls: string[];
  confidence: number;
  confirmationQuestion: string;
}

/**
 * A client-specific discovery question. Every question is anchored to a fact, gap,
 * Canvas block, flow step, or constraint hypothesis so the live call is not generic.
 */
export interface DiscoveryQuestion {
  id: string;
  section: DiscoverySection;
  question: string;
  whyItMatters: string;
  publicAssumption: string;
  sourceUrls: string[];
  evidenceStatus: Extract<Provenance, "public-research" | "advisor-note" | "gap">;
  canvasBlock?: CanvasBlock;
  flowStepId?: string;
  hypothesisId?: string;
  expectedAnswerType: "narrative" | "number" | "person" | "choice";
  required: boolean;
  followUps: string[];
}

export interface ResearchSynthesis {
  sourceUrl: string;
  fetchedAt: string;
  fetchStatus: "fetched" | "fallback";
  title: string;
  description: string;
  facts: EvidenceClaim[];
  gaps: string[];
  constraintHypotheses: ConstraintHypothesis[];
  valueFlow?: ValueFlowStep[];
  discoveryQuestions?: DiscoveryQuestion[];
  researchMode?: "deterministic" | "openai-web-search";
  providerStatus?: "used" | "not-configured" | "failed";
  providerModel?: string;
  sourceCount?: number;
}

export interface TranscriptLine {
  speaker: string;
  timestamp: string;
  text: string;
  speakerConfidence: "unknown" | "advisor-verified";
  provenance: "client-stated" | "advisor-note" | "gap";
}

/**
 * A research claim the client contradicted, corrected, or confirmed on the call.
 * The client's words always win; research is downgraded, never promoted silently.
 */
export interface TranscriptContradiction {
  researchStatement: string;
  researchSourceUrl?: string;
  clientQuote: string;
  speaker: string;
  timestamp: string;
  canvasBlock?: CanvasBlock;
  resolution: "client-corrected" | "client-confirmed" | "unresolved";
}

export interface TranscriptDecision {
  decision: string;
  quote: string;
  speaker: string;
  timestamp: string;
  owner: string;
}

export interface TranscriptTask {
  task: string;
  quote: string;
  speaker: string;
  timestamp: string;
  owner: string;
  flowStepId?: string;
}

/** A Canvas block update proposed from client-stated transcript evidence. */
export interface CanvasUpdate {
  canvasBlock: CanvasBlock;
  statement: string;
  quote: string;
  speaker: string;
  timestamp: string;
  provenance: Extract<Provenance, "client-stated">;
  replacesResearchStatement?: string;
}

export interface TranscriptSynthesis {
  callNumber: 1 | 2;
  lineCount: number;
  quotes: Array<TranscriptLine & { reason: string; provenance: "client-stated" }>;
  metrics: ExtractedMetric[];
  baselineStatus: BaselineStatus;
  gaps: string[];
  constraintCandidate: ConstraintFinding | null;
  contradictions?: TranscriptContradiction[];
  decisions?: TranscriptDecision[];
  tasks?: TranscriptTask[];
  canvasUpdates?: CanvasUpdate[];
  flowConfirmations?: Array<{
    flowStepId: string;
    status: "confirmed" | "corrected" | "unconfirmed";
    quote: string;
    speaker: string;
    timestamp: string;
  }>;
  roles?: RoleMapEntry[];
  analysisMode?: "deterministic" | "model-assisted";
  speakerSummary?: Array<{ speaker: string; lines: number; provenance: TranscriptLine["provenance"] }>;
}

export interface ExtractedMetric {
  label: string;
  value: string;
  quote: string;
  speaker: string;
  timestamp: string;
  unit: string;
  period: string;
  provenance: "client-stated";
}

export interface BaselineMetric {
  name: string;
  value: string;
  unit: string;
  period: string;
  source: string;
}

export interface ConstraintFinding {
  constraintId: string;
  client: string;
  canvasBlock: string;
  constraintType: ConstraintType;
  findingStatus: Exclude<FindingStatus, "none">;
  symptoms: Array<{ statement: string; number: string }>;
  evidence: Array<{
    quote: string;
    speaker: string;
    timestamp: string;
    transcriptUrl: string;
    provenance: "client-stated";
  }>;
  baselineMetric: BaselineMetric;
  prescription: {
    description: string;
    whySmallestIntervention: string;
  };
  projectedDelta: {
    formula: string;
    namedInputs: string[];
    low: string;
    base: string;
    high: string;
    confidence: string;
  };
  baselineInstrumentation: {
    required: boolean;
    firstSprintTask: string;
    measurementClockStartsWhen: string;
  };
  humanOwner: { name: string; role: string };
  predictedNextConstraint: string;
  killCondition: string;
  appendixItems: string[];
}

export interface RoleMapEntry {
  person: string;
  reportsTo: string;
  responsibilities: string[];
  tasks: string[];
  doesTask: boolean;
  accountableForOutcome: boolean;
  judgmentOrGrind: "judgment" | "grind" | "mixed";
  approvalAuthority: string;
  singlePointDependency: boolean;
}

const STATE_TO_STAGE: Record<WorkflowState, CrmStage> = {
  RECON_DRAFT: "Research",
  GUIDED_CANVAS_COMPLETE: "Call",
  TRANSCRIPT_1_SYNTHESIZED: "Synthesize",
  CANVAS_COMMIT_APPROVED: "Prepare",
  FINDINGS_CALL_COMPLETE: "Call",
  TRANSCRIPT_2_RECONCILED: "Synthesize",
  DIAGNOSIS_APPROVED: "Deliver",
  SPRINT_ACTIVE: "Sprint & Catalog",
  OUTCOME_MEASURED: "Sprint & Catalog",
  CATALOG_WRITTEN: "Sprint & Catalog",
};

export function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

/**
 * Resolve any spelling of a Business Model Canvas block to the single canonical name,
 * or null when the value is not a Canvas block at all.
 */
export function canonicalCanvasBlock(value: unknown): CanvasBlock | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const exact = CANVAS_BLOCKS.find((block) => block.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  return CANVAS_BLOCK_ALIASES[trimmed.toLowerCase()] ?? null;
}

export function emptyCanvas(): Record<CanvasBlock, EvidenceClaim[]> {
  return Object.fromEntries(
    CANVAS_BLOCKS.map((block) => [block, [] as EvidenceClaim[]]),
  ) as unknown as Record<CanvasBlock, EvidenceClaim[]>;
}

export function stageForState(state: WorkflowState): CrmStage {
  return STATE_TO_STAGE[state];
}

export function assertWorkflowTransition(
  current: WorkflowState,
  next: WorkflowState,
  baselineStatus: BaselineStatus,
  findingStatus: FindingStatus,
): void {
  if (current === next) return;
  const currentIndex = WORKFLOW_STATES.indexOf(current);
  const nextIndex = WORKFLOW_STATES.indexOf(next);
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Workflow may advance only one checkpoint at a time (${current} -> ${next} is invalid).`);
  }
  if (next === "DIAGNOSIS_APPROVED" && findingStatus === "approved" && baselineStatus !== "Confirmed") {
    throw new Error("An approved finding requires a confirmed baseline; keep the finding provisional.");
  }
  if (next === "OUTCOME_MEASURED" && baselineStatus !== "Confirmed") {
    throw new Error("Outcome measurement requires a confirmed baseline.");
  }
  if (next === "CATALOG_WRITTEN" && current !== "OUTCOME_MEASURED") {
    throw new Error("Catalog write-back requires a measured outcome.");
  }
}

export function makeId(prefix: string, seed = crypto.randomUUID()): string {
  return `${prefix}_${seed.replaceAll("-", "").slice(0, 20)}`;
}

export function createDemoEngagement(now = "2026-07-24T16:00:00.000Z"): Engagement {
  return {
    id: "eng_demo_northstar",
    ownerId: "demo",
    client: "Northstar Fabrication",
    website: "https://example.com",
    primaryContact: "Morgan Lee",
    email: "morgan@example.com",
    advisor: "Tier 4 Advisor",
    stage: "Synthesize",
    status: "Needs review",
    workflowState: "TRANSCRIPT_1_SYNTHESIZED",
    nextAction: "Review the provisional constraint and baseline gaps",
    dueDate: null,
    lastContact: now,
    call1At: now,
    call2At: null,
    readinessBriefStatus: "Sent",
    readinessBriefSentAt: now,
    baselineStatus: "Partial",
    engagementFolder: "",
    notes: "Deterministic demo record. Replace every example claim with client evidence before approval.",
    findingStatus: "provisional",
    data: {
      sourceRegister: [
        {
          id: "src_demo_public",
          label: "Demo public website",
          url: "https://example.com",
          provenance: "public-research",
          capturedAt: now,
        },
      ],
      baseline: {
        name: "Estimate turnaround time",
        value: "",
        unit: "days",
        period: "per estimate",
        source: "Missing: confirm with client",
      },
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
