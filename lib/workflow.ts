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

export const BASELINE_STATUSES = ["Missing", "Partial", "Confirmed"] as const;
export const READINESS_STATUSES = ["Not drafted", "Drafted", "Approved", "Sent"] as const;
export const CONSTRAINT_TYPES = ["capacity", "latency", "quality", "knowledge", "policy"] as const;
export const PROVENANCE = ["client-stated", "doc", "public-research", "advisor-note", "gap"] as const;

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
  canvas?: Record<string, EvidenceClaim[]>;
  roles?: RoleMapEntry[];
  transcriptSynthesis?: TranscriptSynthesis[];
  approvedReadinessBrief?: ApprovedReadinessBrief;
  recordingConsent?: Partial<Record<"call1" | "call2", ConsentAttestation>>;
  [key: string]: unknown;
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
}

export interface ConstraintHypothesis {
  canvasBlock: string;
  type: ConstraintType;
  evidenceHint: string;
  confirmationCondition: string;
  killCondition: string;
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
}

export interface TranscriptLine {
  speaker: string;
  timestamp: string;
  text: string;
  speakerConfidence: "unknown" | "advisor-verified";
  provenance: "client-stated" | "advisor-note" | "gap";
}

export interface TranscriptSynthesis {
  callNumber: 1 | 2;
  lineCount: number;
  quotes: Array<TranscriptLine & { reason: string; provenance: "client-stated" }>;
  metrics: ExtractedMetric[];
  baselineStatus: BaselineStatus;
  gaps: string[];
  constraintCandidate: ConstraintFinding | null;
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
