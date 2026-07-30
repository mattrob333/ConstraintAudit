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
  /**
   * An invitation to a Throughput Audit, addressed to one client on the advisor's roster.
   * Client-roster-scoped rather than engagement-scoped: it exists before any engagement does.
   * Queuing it sends nothing — the send happens only from the Reviewed actions screen.
   */
  "audit_invite",
] as const;

export const INTENT_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
  "executing",
  "executed",
  "failed",
] as const;

/**
 * Firmographic bands. Deliberately coarse: an advisor can answer these from memory at intake,
 * and a band is honest about its own precision in a way a headcount guess is not. `""` is a
 * first-class value everywhere — firmographics are optional and "not stated" is never inferred.
 */
export const HEADCOUNT_BANDS = ["", "1-9", "10-49", "50-249", "250+"] as const;
export const BUSINESS_MODELS = [
  "", "services", "manufacturing", "distribution", "retail", "software", "other",
] as const;

export const BASELINE_STATUSES = ["Missing", "Partial", "Confirmed"] as const;
export const READINESS_STATUSES = ["Not drafted", "Drafted", "Approved", "Sent"] as const;
export const CONSTRAINT_TYPES = ["capacity", "latency", "quality", "knowledge", "policy"] as const;
export const PROVENANCE = ["client-stated", "doc", "public-research", "advisor-note", "gap"] as const;

/**
 * How a kill condition is tested: which way the business metric had to move for the
 * constraint to be the constraint. `does-not-move` is the honest default for a stop
 * condition phrased as "and nothing changed".
 */
export const KILL_COMPARATORS = ["increases", "decreases", "reaches", "does-not-move"] as const;

/**
 * Whether the client's own stop condition survived the sprint. `not-tested` is the value a
 * measurement starts at and is never a pass: an untested kill condition blocks the catalog
 * write, because a pattern nobody tried to disprove is not a pattern.
 */
export const KILL_CONDITION_RESULTS = ["held", "fired", "not-tested"] as const;

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
export type HeadcountBand = (typeof HEADCOUNT_BANDS)[number];
export type BusinessModel = (typeof BUSINESS_MODELS)[number];
export type KillComparator = (typeof KILL_COMPARATORS)[number];
export type KillConditionResult = (typeof KILL_CONDITION_RESULTS)[number];
/**
 * `"full"` only when the unit, the period, and (for a percentage) the denominator are each
 * literally present in the client line the value was matched to. Anything else is `"partial"`:
 * the number was said, what it measures was not. Only `"full"` can confirm a baseline.
 */
export type MetricGrounding = "full" | "partial";

/**
 * The advisor's kill condition in a shape the outcome can actually test, beside — never
 * instead of — the client's own words. Absent whenever no honest structure can be derived:
 * an invented threshold or window would be a fabricated commitment in the client's mouth.
 */
export interface KillConditionSpec {
  /** The business measure being watched, e.g. "Win rate on quoted work". */
  metric: string;
  comparator: KillComparator;
  /** How far it had to move, in the client's own terms, e.g. "no increase from 20 percent". */
  threshold: string;
  /** How long it was watched for, e.g. "4 weeks". */
  window: string;
}

/**
 * One advisor override of a model-authored field, kept beside the model's original so the
 * document can always say which words are the advisor's judgment and which are the model's.
 * Advisor prose is `advisor-note` provenance; it is never presented as a client quote.
 */
export interface AdvisorEdit {
  field: string;
  /** The model's value before the edit, serialized for display. */
  original: string;
  /** The advisor's value, serialized for display. */
  edited: string;
  editedAt: string;
  editedBy: string;
}

/**
 * What kind of business this is, captured at intake. Advisor-stated context, not evidence:
 * nothing here is client-stated, nothing here may appear in a Canvas claim, a quote, or a
 * baseline, and no part of the diagnosis is allowed to lean on it as fact.
 */
export interface Firmographics {
  industry: string;
  headcountBand: HeadcountBand;
  businessModel: BusinessModel;
}

export function emptyFirmographics(): Firmographics {
  return { industry: "", headcountBand: "", businessModel: "" };
}

/**
 * Coerce arbitrary input into firmographics. An unrecognised band or model becomes `""`
 * ("not stated") rather than being coerced to the nearest value — a wrong band read as a
 * real one would be an invented fact about the client.
 */
export function normalizeFirmographics(value: unknown): Firmographics {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const industry = typeof source.industry === "string" ? source.industry.trim().slice(0, 120) : "";
  const headcountBand = isOneOf(HEADCOUNT_BANDS, source.headcountBand) ? source.headcountBand : "";
  const businessModel = isOneOf(BUSINESS_MODELS, source.businessModel) ? source.businessModel : "";
  return { industry, headcountBand, businessModel };
}

/** True when the advisor stated nothing at all, so the record can skip storing an empty object. */
export function firmographicsAreEmpty(value: Firmographics): boolean {
  return !value.industry && !value.headcountBand && !value.businessModel;
}

export interface Engagement {
  id: string;
  /** Owning advisor principal. Every read and write is scoped to this value. */
  ownerId: string;
  client: string;
  website: string;
  primaryContact: string;
  /** Structured so diagnosis approval can reuse it as the named owner's role. */
  primaryContactRole: string;
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
  /** Optional advisor-stated context about the business. Never evidence — see Firmographics. */
  firmographics?: Firmographics;
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
  /** Carried so the outcome screen can preview the direction with the same context the server resolves it with. */
  constraintType?: ConstraintType;
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
  /**
   * `direction` is the arithmetic fact. Whether that fact is good or bad depends on the
   * metric — a shorter turnaround is an improvement, a smaller throughput is not — so
   * `interpretation` stays `not-interpreted` unless the advisor declares `improvedWhen`.
   * Nothing in this app is allowed to guess which way is better.
   */
  delta: {
    absolute: string;
    percent: string;
    direction: "increased" | "decreased" | "unchanged";
    interpretation: "improved" | "worsened" | "unchanged" | "not-interpreted";
  } | null;
  deltaBlockedReason?: string;
  improvedWhen?: "higher" | "lower";
  /** How `improvedWhen` was arrived at, so the advisor can see and override the reasoning. */
  directionInference?: DirectionInference;
  constraintMoved: boolean;
  nextConstraintObserved: string;
  evidence: Array<{ quote: string; source: string }>;
  /**
   * Whether the client's own kill condition held or fired. Audit F2: the operational metric
   * moving is not the test — Dana's condition was "quotes in three days and we still do not
   * win any more of them", and the schema had nowhere to record that it was never checked.
   * `fired` is a first-class honest outcome: the pattern is still written to the catalog, and
   * the entry records that the constraint was disproven.
   */
  killConditionResult: KillConditionResult;
  /**
   * The business number the constraint was supposed to move, before and after — distinct from
   * the operational metric in `startingMetric`/`endingMetric`. For Meridian: the win rate, not
   * the quote turnaround. Absent when no business reading was taken; it is never inferred.
   */
  businessMetric?: { starting: BaselineMetric; ending: BaselineMetric };
}

/**
 * Which way a metric has to move to count as an improvement, and how that was decided.
 * `source: "advisor"` always wins — an inference is a default, never a verdict.
 */
export interface DirectionInference {
  improvedWhen: "higher" | "lower" | null;
  source: "advisor" | "unit-table" | "metric-semantics" | "model" | "none";
  /** Plain-language reason shown next to the result, e.g. "days measure elapsed time". */
  basis: string;
  confidence: number;
  /** Set when two readings of the metric name disagree; the advisor must settle it. */
  ambiguous?: boolean;
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
  /**
   * How the client's kill condition ended. A `fired` entry is kept, not suppressed — a pattern
   * that was disproven on a real engagement is worth more to the next diagnosis than silence.
   */
  killConditionResult?: KillConditionResult;
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
  modelStatus?: "used" | "not-configured" | "failed";
  providerModel?: string;
  /**
   * The model's own reading of the call. Advisor-note provenance always — it is an
   * interpretation, never client evidence, and never a substitute for a quote.
   */
  narrative?: string;
  /**
   * Everything the model returned that failed grounding, kept so a silent drop is
   * never mistaken for the model having found nothing.
   */
  groundingRejections?: Array<{ kind: string; reason: string; text: string }>;
  speakerSummary?: Array<{ speaker: string; lines: number; provenance: TranscriptLine["provenance"] }>;
  /**
   * Recorded when the model pass and the deterministic pass read the same transcript as
   * different constraints. Its presence forces the finding to stay provisional; it is kept
   * structured (not only as a gap sentence) so the disagreement can be surfaced, not buried.
   */
  pathDisagreement?: {
    model: { constraintType: ConstraintType; canvasBlock: string };
    deterministic: { constraintType: ConstraintType; canvasBlock: string };
    fields: Array<"constraintType" | "canvasBlock">;
  };
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
  /**
   * Optional so anything persisted before the grounding layer still parses. Both read as the
   * *weaker* value when absent, never the stronger one — an undefined `grounding` is not "full".
   */
  grounding?: MetricGrounding;
  /** The exact spans of the cited line that carry the unit, the period, and the denominator. */
  unitSpan?: string;
  periodSpan?: string;
  denominatorSpan?: string;
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
  /** The client's own stop condition, verbatim. Never rewritten by the structured spec below. */
  killCondition: string;
  /**
   * The same condition in a shape the outcome can test. Additive and optional: it is set only
   * where a metric, comparator, threshold, and window can be read out honestly. Where they
   * cannot, the sentence stands alone rather than being padded with an invented threshold.
   */
  killConditionSpec?: KillConditionSpec;
  appendixItems: string[];
  /**
   * Every advisor override of a model-authored field, with the model's original kept beside it.
   * Editing never approves anything and never rewrites a quote — evidence edits are selection
   * only, so nothing the advisor types can be presented as the client's words.
   */
  advisorEdits?: AdvisorEdit[];
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

const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, bn: 1e9 };

/**
 * Parse one comparable reading, or null when the value cannot be compared safely.
 *
 * Returns null for a RANGE ("3 to 5 days", "3-5"): taking the low end silently invented a
 * baseline. Honours a magnitude suffix (1.2m, 900k), because reading "$1.2m" as 1.2 and
 * "$900k" as 900 turned a revenue drop into a 749x "improvement". The suffix must be at a
 * word boundary — the negative lookahead stops "5 min" being read as five million.
 */
export function parseMeasure(value: string): number | null {
  const cleaned = value.replace(/,/g, "");
  // A range is two numbers joined by a dash or "to"; it is not a single reading.
  if (/\d\s*(?:-|–|—|to)\s*\d/i.test(cleaned)) return null;
  const match = cleaned.match(/-?\d+(?:\.\d+)?\s*(bn|[km])?(?![a-z])/i);
  if (!match) return null;
  const parsed = Number(match[0].replace(/\s*(bn|[km])$/i, "").trim());
  if (!Number.isFinite(parsed)) return null;
  const suffix = (match[1] ?? "").toLowerCase();
  return suffix ? parsed * (MAGNITUDE[suffix] ?? 1) : parsed;
}

/** "days per estimate" — the period often already reads as a phrase, so don't double the "per". */
function describeMeasure(metric: BaselineMetric | undefined): string {
  const unit = metric?.unit?.trim() ?? "";
  const period = metric?.period?.trim() ?? "";
  if (!period) return unit || "an unlabelled reading";
  return /^(per|each|every|a|an)\b/i.test(period) ? `${unit} ${period}` : `${unit} per ${period}`;
}

/**
 * Compare two readings. A number is produced only from two client-confirmed readings in
 * the same unit and period; every other case returns an explicit blocked reason instead.
 *
 * `direction` is arithmetic. Calling a change an improvement requires `improvedWhen`,
 * because whether up is good depends on the metric — a shorter turnaround is a win, a
 * smaller throughput is not. The app must never guess which way is better.
 */
export function computeMetricDelta(
  starting: BaselineMetric | undefined,
  ending: BaselineMetric,
  options: { baselineConfirmed: boolean; improvedWhen?: "higher" | "lower" },
): { delta: OutcomeMeasurement["delta"]; blockedReason?: string } {
  if (!options.baselineConfirmed) {
    return { delta: null, blockedReason: "The starting metric was never confirmed, so no before/after delta may be claimed." };
  }
  const startValue = parseMeasure(starting?.value ?? "");
  const endValue = parseMeasure(ending.value ?? "");
  if (startValue === null || endValue === null) {
    return { delta: null, blockedReason: "One of the readings is not numeric, so no delta may be computed." };
  }
  const sameUnit = (starting?.unit ?? "").trim().toLowerCase() === (ending.unit ?? "").trim().toLowerCase();
  const samePeriod = (starting?.period ?? "").trim().toLowerCase() === (ending.period ?? "").trim().toLowerCase();
  if (!sameUnit || !samePeriod) {
    return {
      delta: null,
      blockedReason: `Readings are not comparable (${describeMeasure(starting)} vs ${describeMeasure(ending)}).`,
    };
  }
  const absolute = endValue - startValue;
  const direction = absolute === 0 ? "unchanged" as const
    : absolute > 0 ? "increased" as const : "decreased" as const;
  return {
    delta: {
      absolute: `${absolute > 0 ? "+" : ""}${Number(absolute.toFixed(4))} ${ending.unit}`,
      percent: startValue === 0
        ? "not computable from a zero baseline"
        : `${absolute > 0 ? "+" : ""}${Number(((absolute / Math.abs(startValue)) * 100).toFixed(1))}%`,
      direction,
      interpretation: direction === "unchanged" ? "unchanged"
        : !options.improvedWhen ? "not-interpreted"
        : (options.improvedWhen === "higher") === (direction === "increased") ? "improved" : "worsened",
    },
  };
}

export function emptyCanvas(): Record<CanvasBlock, EvidenceClaim[]> {
  return Object.fromEntries(
    CANVAS_BLOCKS.map((block) => [block, [] as EvidenceClaim[]]),
  ) as unknown as Record<CanvasBlock, EvidenceClaim[]>;
}

export function stageForState(state: WorkflowState): CrmStage {
  return STATE_TO_STAGE[state];
}

/**
 * A baseline is bound when it names a real reading traced to a source. `Missing` is the exact
 * string the grounding layer writes when no metric measured the constraint, so a finding
 * carrying it has a baselineStatus that says Confirmed and a baseline that measures nothing.
 */
export function baselineMetricIsBound(metric: BaselineMetric | null | undefined): boolean {
  if (!metric) return false;
  const source = metric.source?.trim() ?? "";
  if (!source || /^missing\b/i.test(source)) return false;
  return Boolean(metric.name?.trim() && metric.value?.trim());
}

/**
 * Evidence the state machine needs that the flat status columns cannot carry. Every field is
 * optional and every absent field reads as the weaker value: an unsupplied baseline is
 * unbound, an unsupplied kill-condition result is `not-tested`. The gate fails closed.
 */
export interface WorkflowTransitionEvidence {
  /** The finding's own baseline, not the engagement's baselineStatus column. */
  baselineMetric?: BaselineMetric | null;
  /** The outcome's kill-condition test. */
  killConditionResult?: KillConditionResult;
}

export function assertWorkflowTransition(
  current: WorkflowState,
  next: WorkflowState,
  baselineStatus: BaselineStatus,
  findingStatus: FindingStatus,
  evidence: WorkflowTransitionEvidence = {},
): void {
  if (current === next) return;
  const currentIndex = WORKFLOW_STATES.indexOf(current);
  const nextIndex = WORKFLOW_STATES.indexOf(next);
  if (nextIndex !== currentIndex + 1) {
    throw new Error(`Workflow may advance only one checkpoint at a time (${current} -> ${next} is invalid).`);
  }
  if (next === "DIAGNOSIS_APPROVED" && findingStatus === "approved") {
    if (baselineStatus !== "Confirmed") {
      throw new Error("An approved finding requires a confirmed baseline; keep the finding provisional.");
    }
    // baselineStatus is constraint-blind: it says a number was confirmed somewhere in the call,
    // not that the finding's own baseline measures this constraint (audit F4).
    if (!baselineMetricIsBound(evidence.baselineMetric)) {
      throw new Error("An approved finding requires a baseline bound to the constraint; this finding's baseline metric is Missing, so keep the finding provisional.");
    }
  }
  if (next === "OUTCOME_MEASURED" && baselineStatus !== "Confirmed") {
    throw new Error("Outcome measurement requires a confirmed baseline.");
  }
  if (next === "CATALOG_WRITTEN" && current !== "OUTCOME_MEASURED") {
    throw new Error("Catalog write-back requires a measured outcome.");
  }
  // Audit F2: the catalog used to publish "improved" on an engagement where nobody checked the
  // number the constraint was supposed to move. `fired` passes — a disproven constraint is an
  // honest entry — but an untested one does not.
  if (next === "CATALOG_WRITTEN" && (evidence.killConditionResult ?? "not-tested") === "not-tested") {
    throw new Error("Catalog write-back is blocked while the kill condition is untested. Record on the Measure screen whether the client's own kill condition held or fired.");
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
    primaryContactRole: "Owner",
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
