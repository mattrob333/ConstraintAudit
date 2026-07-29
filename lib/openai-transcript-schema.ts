import {
  CONSTRAINT_TYPES,
  canonicalCanvasBlock,
  type CanvasBlock,
  type CanvasUpdate,
  type ConstraintType,
  type DiscoveryQuestion,
  type EvidenceClaim,
  type ExtractedMetric,
  type RoleMapEntry,
  type TranscriptContradiction,
  type TranscriptDecision,
  type TranscriptLine,
  type TranscriptSynthesis,
  type TranscriptTask,
  type ValueFlowStep,
} from "./workflow";

/* ------------------------------------------------------- shared additions */

/**
 * Two fields the evidence layer needs on records owned by `./workflow`, added by declaration
 * merging so the storage types stay in one place. Both are optional so anything persisted
 * before this change still parses; both read as the *weaker* value when absent, never the
 * stronger one — an undefined `grounding` is not "full".
 */
declare module "./workflow" {
  interface ExtractedMetric {
    /**
     * `"full"` only when the unit, the period, and (for a percentage) the denominator are each
     * literally present in the client line the value was matched to. Anything else is
     * `"partial"`: the number was said, what it measures was not. Only `"full"` can confirm a
     * baseline.
     */
    grounding?: MetricGrounding;
    /** The exact spans of the cited line that carry the unit, the period, and the denominator. */
    unitSpan?: string;
    periodSpan?: string;
    denominatorSpan?: string;
  }

  interface TranscriptSynthesis {
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
}

/* ------------------------------------------------------------------ types */

export type MetricGrounding = "full" | "partial";

/** What a constraint citation is doing. A constraint with no `mechanism` citation is not one. */
export const EVIDENCE_ROLES = ["symptom", "mechanism", "magnitude", "single_point_dependency"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/** The dimension a metric measures in, used to check a baseline actually measures the constraint. */
export type MetricDimension = "time" | "count-per-period" | "rate";

export type GroundingRejection = NonNullable<TranscriptSynthesis["groundingRejections"]>[number];
export type FlowConfirmation = NonNullable<TranscriptSynthesis["flowConfirmations"]>[number];
export type GroundedTranscriptQuote = TranscriptSynthesis["quotes"][number];

/** A citation that survived grounding. Every field is copied from the matched line, never from the model. */
export type GroundedQuote = {
  quote: string;
  speaker: string;
  timestamp: string;
  speakerConfidence: TranscriptLine["speakerConfidence"];
  /** 1-based index of the transcript line the quote was matched to. */
  line: number;
};

/** A constraint citation that survived grounding, carrying what the client line is doing. */
export type ConstraintCitation = GroundedQuote & { role: EvidenceRole };

/** A rival the model examined and rejected, with the client line that argues against it. */
export type RejectedHypothesis = {
  constraintType: ConstraintType;
  canvasBlock: CanvasBlock;
  reason: string;
  quote: string;
  speaker: string;
  timestamp: string;
  /** 1-based index of the transcript line the rejection was grounded to. */
  line: number;
};

export type ModelConstraint = {
  constraintType: ConstraintType;
  canvasBlock: CanvasBlock;
  reasoning: string;
  symptomVsConstraint: string;
  prescription: string;
  whySmallestIntervention: string;
  killCondition: string;
  predictedNextConstraint: string;
  evidence: ConstraintCitation[];
  /** Index into `GroundedSynthesis.metrics`, or -1 when no metric survived baseline validation. */
  baselineMetricIndex: number;
  /** The validated baseline itself. Null means Missing; it is never silently reassigned. */
  baselineMetric: ExtractedMetric | null;
  /** Why that metric measures this constraint. Required for knowledge and policy constraints. */
  baselineReason: string;
};

/** Optional catalogs the caller already holds. Absent context narrows what can be grounded, never widens it. */
export type GroundingCatalog = {
  /** Research facts the model is allowed to contradict or replace. */
  facts?: EvidenceClaim[];
  /** Discovery questions the model is allowed to flag as unanswered. */
  questions?: DiscoveryQuestion[];
};

export type GroundedSynthesis = {
  quotes: GroundedTranscriptQuote[];
  metrics: ExtractedMetric[];
  contradictions: TranscriptContradiction[];
  canvasUpdates: CanvasUpdate[];
  flowConfirmations: FlowConfirmation[];
  decisions: TranscriptDecision[];
  tasks: TranscriptTask[];
  roles: RoleMapEntry[];
  /** Model interpretation. Always advisor-note; never merged into a quote, metric, or Canvas claim. */
  narrative: string;
  gaps: string[];
  rejections: GroundingRejection[];
  constraint: ModelConstraint | null;
  /** Grounded rivals the model rejected. Ungrounded ones are discarded, never printed. */
  rejectedHypotheses: RejectedHypothesis[];
  unansweredQuestions: DiscoveryQuestion[];
};

/* ---------------------------------------------------------------- helpers */

const MAX_ITEMS = 25;
const MAX_ROLES = 12;
const MAX_REJECTIONS = 60;
const MAX_QUOTE = 1_000;
const MAX_SPAN = 160;
/** Two rivals, per the audit: enough to show the work, few enough to stay readable. */
const MAX_REJECTED_HYPOTHESES = 2;
/** A constraint needs corroboration, not one line read twice. */
const MIN_CONSTRAINT_LINES = 2;

const RESOLUTIONS = new Set<string>(["client-corrected", "client-confirmed", "unresolved"]);
const FLOW_STATUSES = new Set<string>(["confirmed", "corrected", "unconfirmed"]);
const JUDGMENT_VALUES = new Set<string>(["judgment", "grind", "mixed"]);
const TYPES = new Set<string>(CONSTRAINT_TYPES);
const ROLES = new Set<string>(EVIDENCE_ROLES);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown, maxLength: number, limit: number): string[] {
  return list(value).map((item) => text(item, maxLength)).filter(Boolean).slice(0, limit);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Typographic variants that must not be the reason a real quote fails to match. */
const UNIFY: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "´": "'", "`": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
  "…": ".",
};

/** Case-folded, whitespace-collapsed, quote/dash-unified text. Matching happens only in this space. */
function normalize(value: string): string {
  let out = "";
  let gap = false;
  for (const raw of value) {
    if (/\s/.test(raw)) {
      if (out) gap = true;
      continue;
    }
    if (gap) {
      out += " ";
      gap = false;
    }
    out += (UNIFY[raw] ?? raw).toLowerCase();
  }
  return out;
}

/** Exposed so every pass grounds spans in exactly the space quote grounding matches in. */
export function normalizeForGrounding(value: string): string {
  return normalize(value);
}

/* ------------------------------------------------------ metric semantics */

/** Elapsed-time units, singular and plural. A latency baseline has to be one of these. */
const TIME_UNITS = new Set<string>([
  "second", "seconds", "sec", "secs", "minute", "minutes", "min", "mins",
  "hour", "hours", "hr", "hrs", "day", "days", "business day", "business days",
  "working day", "working days", "calendar day", "calendar days",
  "week", "weeks", "month", "months", "quarter", "quarters", "year", "years",
]);

/** Symbols a client says out loud as a symbol but a model writes as a word. */
const UNIT_SYMBOLS: Record<string, string> = {
  "$": "dollars", "£": "pounds", "€": "euros", "%": "percent",
};

export function isPercentUnit(unit: string): boolean {
  const value = normalize(unit);
  return value === "%" || value === "percent" || value === "percentage" || value === "percentage points";
}

export function isTimeUnit(unit: string): boolean {
  return TIME_UNITS.has(normalize(unit));
}

/**
 * What the metric measures in, not what it is called. `null` means the metric is not a
 * measurement of anything nameable — a bare number, or a count with no period over which it
 * was counted — and so can never be a baseline.
 */
export function metricDimension(unit: string, period: string): MetricDimension | null {
  if (isPercentUnit(unit)) return "rate";
  if (isTimeUnit(unit)) return "time";
  if (unit.trim() && period.trim()) return "count-per-period";
  return null;
}

/**
 * Does this metric measure the thing the constraint names?
 *
 * latency is time, capacity is throughput counted over a period, quality is a rate. Knowledge
 * and policy constraints have no single dimension — a price book can be measured in days or in
 * quotes — so any real dimension is allowed there, and the *reason* carries the burden instead.
 */
export function dimensionMatchesConstraint(
  constraintType: ConstraintType,
  unit: string,
  period: string,
): boolean {
  const dimension = metricDimension(unit, period);
  if (!dimension) return false;
  if (constraintType === "latency") return dimension === "time";
  if (constraintType === "capacity") return dimension === "count-per-period";
  if (constraintType === "quality") return dimension === "rate";
  return true;
}

/** Constraint types whose baseline is only defensible with a written justification. */
export function baselineReasonRequired(constraintType: ConstraintType): boolean {
  return constraintType === "knowledge" || constraintType === "policy";
}

/** A span grounds a unit when the client's own words contain it, symbol or word. */
function spanCarries(span: string, value: string): boolean {
  const haystack = normalize(span);
  const needle = normalize(value);
  if (!haystack || !needle) return false;
  if (haystack.includes(needle)) return true;
  const symbol = UNIT_SYMBOLS[span.trim()];
  return symbol !== undefined && symbol === needle;
}

export type MetricSpans = { unitSpan: string; periodSpan: string; denominatorSpan: string };

export type MetricGroundingResult = MetricSpans & {
  grounding: MetricGrounding;
  unit: string;
  period: string;
};

/**
 * The unit, the period and the denominator are grounded exactly the way a quote is: each must
 * be a contiguous span of the client line the number came from, matched on normalized text.
 *
 * F1 of the 2026-07-29 audit: a model emitted `unit:"quotes", period:"month"` against a line
 * that said "9 days per quote", and the grounding layer checked only the digits. A unit or
 * period the client never said is now dropped and the metric lands `partial`, which can never
 * confirm a baseline. A percentage additionally needs the denominator said out loud — a rate
 * with no "out of what" is not a measurement.
 */
export function groundMetricSpans(
  lineText: string,
  unit: string,
  period: string,
  spans: Partial<MetricSpans>,
): MetricGroundingResult {
  const line = normalize(lineText);
  const inLine = (raw: string | undefined): string => {
    const span = unwrapQuote((raw ?? "").trim()).slice(0, MAX_SPAN);
    const needle = normalize(span);
    return needle && line.includes(needle) ? span : "";
  };
  const unitSpan = inLine(spans.unitSpan);
  const periodSpan = inLine(spans.periodSpan);
  const denominatorSpan = inLine(spans.denominatorSpan);

  const unitOk = Boolean(unit.trim()) && spanCarries(unitSpan, unit);
  const periodOk = Boolean(period.trim()) && spanCarries(periodSpan, period);
  const denominatorOk = !isPercentUnit(unit) || Boolean(denominatorSpan);

  return {
    // A unit or period the client did not say is not carried on the metric at all: leaving it
    // in place is how "9 days per quote" became "quotes won per month" downstream.
    unit: unitOk ? unit : "",
    period: periodOk ? period : "",
    unitSpan: unitOk ? unitSpan : "",
    periodSpan: periodOk ? periodSpan : "",
    denominatorSpan,
    grounding: unitOk && periodOk && denominatorOk ? "full" : "partial",
  };
}

const PLACEHOLDER_NAME = /^(?:client-stated\b|unnamed\b|metric$|number$)/i;

/** A generated stand-in is not a name. A metric that has no name cannot anchor a baseline. */
export function hasMeaningfulMetricName(label: string): boolean {
  const name = label.trim();
  return name.length > 1 && !PLACEHOLDER_NAME.test(name);
}

/**
 * A readable name built only from what the client actually said. `metricLabel` used to emit
 * "Client-stated day metric", which then fed metric-direction inference and the catalog as if
 * it were the name of a business measure (audit F4).
 */
export function metricNameFor(unit: string, period: string): string {
  const measure = unit.trim().toLowerCase();
  const over = period.trim().toLowerCase().replace(/^per\s+/, "");
  if (measure && over) return capitalize(`${measure} per ${over}`);
  if (measure) return capitalize(measure);
  if (over) return `Unnamed rate per ${over}`;
  return "Unnamed client-stated number";
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** A range ("3 to 5 days") is a spread, not a reading, so it can never anchor a delta. */
const RANGE_VALUE = /\d\s*(?:-|–|—|to)\s*\d/i;

/** Everything a metric must satisfy before it is allowed to be called a confirmed baseline. */
export function metricCanConfirmBaseline(metric: ExtractedMetric): boolean {
  return Boolean(
    metric &&
    metric.grounding === "full" &&
    hasMeaningfulMetricName(metric.label ?? "") &&
    metric.value?.trim() &&
    /\d/.test(metric.value) &&
    !RANGE_VALUE.test(metric.value) &&
    metric.unit?.trim() &&
    metric.period?.trim() &&
    metric.quote?.trim() &&
    metric.speaker?.trim() &&
    metric.timestamp?.trim() &&
    metric.provenance === "client-stated",
  );
}

/**
 * The baseline is the first fully grounded metric that measures the constraint's own dimension.
 * There is deliberately no fallback: "first number with a period" (audit F4) made monthly
 * enquiry volume the baseline for a latency constraint. No match means Missing.
 */
export function selectBaselineMetric(
  metrics: ExtractedMetric[],
  constraintType: ConstraintType,
): ExtractedMetric | null {
  return (metrics ?? []).find((metric) =>
    metricCanConfirmBaseline(metric) &&
    dimensionMatchesConstraint(constraintType, metric.unit, metric.period)) ?? null;
}

/* ------------------------------------------------- two passes, one finding */

export type ConstraintReading = { constraintType: ConstraintType; canvasBlock: string };
export type PathDisagreement = NonNullable<TranscriptSynthesis["pathDisagreement"]>;

/**
 * Where the model pass and the deterministic pass read the same transcript differently.
 *
 * Audit F5: the same upload produced `knowledge` or `latency` depending on whether an HTTP
 * call succeeded, and the disagreement was written into a gap string that changed nothing.
 * Returning a structured value here is what lets `findingStatusFor` withdraw verification and
 * what lets the disagreement be shown rather than buried in prose.
 */
export function pathDisagreementBetween(
  deterministic: ConstraintReading | null | undefined,
  model: ConstraintReading | null | undefined,
): PathDisagreement | null {
  if (!deterministic || !model) return null;
  const fields: PathDisagreement["fields"] = [];
  if (deterministic.constraintType !== model.constraintType) fields.push("constraintType");
  if (deterministic.canvasBlock !== model.canvasBlock) fields.push("canvasBlock");
  if (fields.length === 0) return null;
  return {
    model: { constraintType: model.constraintType, canvasBlock: model.canvasBlock },
    deterministic: {
      constraintType: deterministic.constraintType,
      canvasBlock: deterministic.canvasBlock,
    },
    fields,
  };
}

/**
 * The single place a finding is allowed to stop being provisional. Every clause is a veto:
 * a confirmed baseline, a baseline that measures *this* constraint, the second call, no
 * conflict with the first call, and no disagreement between the two reading passes.
 */
export function findingStatusFor(input: {
  baselineStatus: TranscriptSynthesis["baselineStatus"];
  baselineMetric: ExtractedMetric | null;
  callNumber: 1 | 2;
  priorConflict: boolean;
  pathDisagreement: PathDisagreement | null;
}): "client-verified" | "provisional" {
  const verified =
    input.baselineStatus === "Confirmed" &&
    input.baselineMetric !== null &&
    input.callNumber === 2 &&
    !input.priorConflict &&
    input.pathDisagreement === null;
  return verified ? "client-verified" : "provisional";
}

/** The "not the constraint" appendix line for a rival the model examined and rejected. */
export function rejectedHypothesisAppendixItem(item: RejectedHypothesis): string {
  return `Not the constraint — ${item.constraintType} (${item.canvasBlock}): ${item.reason} Client line ${item.line}, ${item.speaker} at ${item.timestamp}: "${item.quote.slice(0, 220)}"`;
}

/** Wrapping quotation marks and truncation ellipses are presentation, not content. */
function unwrapQuote(value: string): string {
  return value
    .replace(/^\s*["'‘’“”]+/, "")
    .replace(/["'‘’“”]+\s*$/, "")
    .replace(/^\s*(?:\.{3}|…)\s*/, "")
    .replace(/\s*(?:\.{3}|…)\s*$/, "")
    .trim();
}

/* ------------------------------------------------------------- grounding */

type GroundingIndex = {
  lines: TranscriptLine[];
  normals: string[];
  /** Speaker labels, client speech, and traced flow actors — the only places a real name can come from. */
  corpus: string;
};

type Grounding =
  | { ok: true; value: GroundedQuote }
  | { ok: false; reason: string; detail: string };

function groundingIndex(lines: TranscriptLine[], valueFlow: ValueFlowStep[]): GroundingIndex {
  return {
    lines,
    normals: lines.map((line) => normalize(line.text)),
    corpus: normalize([
      ...lines.map((line) => line.speaker),
      ...lines.filter((line) => line.provenance === "client-stated").map((line) => line.text),
      ...valueFlow.map((step) => step.actor ?? ""),
    ].join(" ")),
  };
}

function groundedFrom(index: GroundingIndex, position: number): GroundedQuote {
  const line = index.lines[position];
  return {
    // The whole matched line is the quote: the model's transcription is never authoritative,
    // and a full line dedupes cleanly against the deterministic pass, which also quotes lines.
    quote: line.text,
    speaker: line.speaker,
    timestamp: line.timestamp,
    speakerConfidence: line.speakerConfidence,
    line: position + 1,
  };
}

/** The model may label the cited text `quote` or `text`; both mean the same thing. */
function citationText(entry: Record<string, unknown>): string {
  return unwrapQuote(text(entry.quote, MAX_QUOTE) || text(entry.text, MAX_QUOTE));
}

/**
 * The single gate every model citation passes through.
 *
 * Primary form is a 1-based line number into the exact numbered transcript the model was shown;
 * `quote` then has to be a contiguous span of that line. A quote with no line number falls back
 * to a literal search across the transcript. Matching is exact-or-substring on normalized text
 * only — never fuzzy, never semantic — the matched line must be `client-stated`, and the quote,
 * speaker, and timestamp are rewritten from that line rather than from what the model said.
 *
 * A citation carrying a line number and no span used to auto-ground (audit F3): it let a
 * constraint be built out of bare line numbers pointing at a question and a logging aside. A
 * citation must now always say which words it is relying on.
 */
function groundCitation(index: GroundingIndex, entry: Record<string, unknown>): Grounding {
  const quote = citationText(entry);
  const cited = Number(entry.line);
  const detail = quote || (Number.isFinite(cited) ? `line ${cited}` : "");

  if (Number.isInteger(cited) && cited > 0) {
    if (cited > index.lines.length) return { ok: false, reason: "line-out-of-range", detail };
    const position = cited - 1;
    const line = index.lines[position];
    if (line.provenance !== "client-stated") {
      return { ok: false, reason: `line-not-client-stated (${line.provenance})`, detail };
    }
    if (!quote) return { ok: false, reason: "citation-has-no-quote-span", detail };
    const needle = normalize(quote);
    if (!needle || !index.normals[position].includes(needle)) {
      return { ok: false, reason: "quote-not-in-cited-line", detail };
    }
    return { ok: true, value: groundedFrom(index, position) };
  }

  if (!quote) return { ok: false, reason: "missing-citation", detail: detail || "(empty)" };
  const needle = normalize(quote);
  if (!needle) return { ok: false, reason: "missing-citation", detail };
  const client = findLine(index, needle, true);
  if (client !== -1) return { ok: true, value: groundedFrom(index, client) };
  const any = findLine(index, needle, false);
  // Reported rather than skipped: an advisor's words being cited as client evidence is the
  // failure this whole module exists to catch, so it must never look like "no match found".
  if (any !== -1) {
    return { ok: false, reason: `line-not-client-stated (${index.lines[any].provenance})`, detail };
  }
  return { ok: false, reason: "quote-not-found-in-transcript", detail };
}

/**
 * Whole-line matches win over substring matches so a fragment that also appears inside a longer
 * line is never attributed to the wrong timestamp.
 */
function findLine(index: GroundingIndex, needle: string, clientOnly: boolean): number {
  const usable = (position: number) =>
    !clientOnly || index.lines[position].provenance === "client-stated";
  for (let position = 0; position < index.normals.length; position += 1) {
    if (usable(position) && index.normals[position] === needle) return position;
  }
  for (let position = 0; position < index.normals.length; position += 1) {
    if (usable(position) && index.normals[position].includes(needle)) return position;
  }
  return -1;
}

/** A name is usable only if the transcript, a speaker label, or a traced flow actor contains it. */
function namedInTranscript(index: GroundingIndex, person: string): boolean {
  const name = normalize(person);
  if (!name) return false;
  const candidates = [name];
  const first = name.split(" ")[0];
  if (first.length >= 3 && first !== name) candidates.push(first);
  return candidates.some((candidate) =>
    new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(candidate)}(?:[^a-z0-9]|$)`).test(index.corpus));
}

/**
 * Every number in the model's value must appear in the cited line as a WHOLE number, not a
 * substring. A substring check let a fabricated "500" ground against a line that only said
 * "1500", which then satisfied every baseline field — the model inventing a client metric.
 * Digits are compared comma-free so "12,500" still matches a line that writes it "12500".
 */
function valueAppearsInLine(value: string, lineText: string): boolean {
  const haystack = normalize(lineText).replace(/,/g, "");
  const numbers = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!numbers) {
    const needle = normalize(value).replace(/,/g, "");
    return needle.length > 0 && haystack.includes(needle);
  }
  // A digit run bounded by non-digits (so "500" does not match inside "1500" or "500.7").
  return numbers.every((number) =>
    new RegExp(`(?:^|[^\\d.])${escapeRegExp(number)}(?:[^\\d.]|$)`).test(haystack));
}

function emptySynthesis(): GroundedSynthesis {
  return {
    quotes: [],
    metrics: [],
    contradictions: [],
    canvasUpdates: [],
    flowConfirmations: [],
    decisions: [],
    tasks: [],
    roles: [],
    narrative: "",
    gaps: [],
    rejections: [],
    constraint: null,
    rejectedHypotheses: [],
    unansweredQuestions: [],
  };
}

/* ----------------------------------------------------------------- parse */

/**
 * Ground an already-parsed model payload against the real transcript.
 *
 * Synchronous, pure, and total: no network, no env, no throw. Anything that cannot be tied to a
 * `client-stated` line in `lines` is dropped and reported in `rejections`, so a caller can always
 * tell "the model found nothing" apart from "the model made something up and we caught it".
 */
export function groundModelSynthesis(
  payload: unknown,
  lines: TranscriptLine[],
  valueFlow: ValueFlowStep[] = [],
  catalog: GroundingCatalog = {},
): GroundedSynthesis {
  try {
    return groundPayload(payload, lines, valueFlow, catalog);
  } catch {
    return emptySynthesis();
  }
}

function groundPayload(
  payload: unknown,
  transcriptLines: TranscriptLine[],
  valueFlow: ValueFlowStep[],
  catalog: GroundingCatalog,
): GroundedSynthesis {
  const model = record(payload);
  const lines = Array.isArray(transcriptLines) ? transcriptLines.filter((line) => record(line)) : [];
  if (!model) return emptySynthesis();

  const steps = Array.isArray(valueFlow) ? valueFlow : [];
  const index = groundingIndex(lines, steps);
  const flowIds = new Set(steps.map((step) => step.id));
  const questions = catalog.questions ?? [];
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const facts = (catalog.facts ?? [])
    .filter((fact) => typeof fact?.statement === "string" && fact.statement.trim());
  const factsByStatement = new Map(facts.map((fact) => [normalize(fact.statement), fact]));

  const rejections: GroundingRejection[] = [];
  const reject = (kind: string, reason: string, detail: string): null => {
    if (rejections.length < MAX_REJECTIONS) {
      rejections.push({ kind, reason, text: detail.slice(0, 300) });
    }
    return null;
  };

  /** Grounds an entry's citation, recording the failure under `kind` when it does not hold. */
  const groundOr = (kind: string, entry: Record<string, unknown>): GroundedQuote | null => {
    const result = groundCitation(index, entry);
    return result.ok ? result.value : reject(kind, result.reason, result.detail);
  };

  /**
   * Resolve a research statement the model claims to be contradicting or replacing. When the
   * caller supplied a research catalog, membership is required; with no catalog there is nothing
   * to check it against, so the statement is kept as written and the client quote still grounds.
   */
  const researchStatement = (kind: string, raw: unknown): EvidenceClaim | string | null => {
    const statement = text(raw, 600);
    if (!statement) return null;
    if (factsByStatement.size === 0) return statement;
    return factsByStatement.get(normalize(statement))
      ?? reject(kind, "research-statement-not-supplied", statement);
  };

  const quotes = list(model.quotes).slice(0, MAX_ITEMS)
    .map((item): GroundedTranscriptQuote | null => {
      const entry = record(item);
      if (!entry) return reject("quote", "not-an-object", "");
      const grounded = groundOr("quote", entry);
      if (!grounded) return null;
      return {
        text: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        speakerConfidence: grounded.speakerConfidence,
        reason: text(entry.reason, 240) || "Cited by the model as constraint evidence.",
        provenance: "client-stated",
      };
    })
    .filter((item): item is GroundedTranscriptQuote => Boolean(item));

  // Model-side positions of the metrics that survived, so `baseline_metric_index` can be
  // resolved against the array the model actually saw rather than the filtered one.
  const metricModelIndex: number[] = [];
  const metrics = list(model.metrics).slice(0, MAX_ITEMS)
    .map((item, position): ExtractedMetric | null => {
      const entry = record(item);
      if (!entry) return reject("metric", "not-an-object", "");
      const value = text(entry.value, 60);
      if (!value) return reject("metric", "empty-value", text(entry.label, 120));
      const grounded = groundOr("metric", entry);
      if (!grounded) return null;
      const lineText = lines[grounded.line - 1].text;
      // The number has to be in the client's own line, not only in the model's rendering of it.
      if (!valueAppearsInLine(value, lineText)) {
        return reject("metric", "value-not-in-matched-line", `${value} | ${grounded.quote}`);
      }
      // ...and so does what the number is a measurement of.
      const measured = groundMetricSpans(
        lineText,
        text(entry.unit, 60).toLowerCase(),
        text(entry.period, 60).toLowerCase(),
        {
          unitSpan: text(entry.unit_span, MAX_SPAN),
          periodSpan: text(entry.period_span, MAX_SPAN),
          denominatorSpan: text(entry.denominator_span, MAX_SPAN),
        },
      );
      const label = text(entry.label, 120) || metricNameFor(measured.unit, measured.period);
      if (measured.grounding === "partial") {
        reject(
          "metric.grounding",
          "unit-period-or-denominator-not-in-cited-line",
          `${label} | ${text(entry.unit, 60)}/${text(entry.period, 60)} | ${grounded.quote}`,
        );
      }
      metricModelIndex.push(position);
      return {
        label,
        value,
        quote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        unit: measured.unit,
        period: measured.period,
        unitSpan: measured.unitSpan,
        periodSpan: measured.periodSpan,
        denominatorSpan: measured.denominatorSpan,
        grounding: measured.grounding,
        provenance: "client-stated",
      };
    })
    .filter((item): item is ExtractedMetric => Boolean(item));

  const contradictions = list(model.contradictions).slice(0, MAX_ITEMS)
    .map((item): TranscriptContradiction | null => {
      const entry = record(item);
      if (!entry) return reject("contradiction", "not-an-object", "");
      const fact = researchStatement("contradiction", entry.research_statement);
      if (!fact) return reject("contradiction", "empty-research-statement", "");
      const grounded = groundOr("contradiction", entry);
      if (!grounded) return null;
      const resolution = text(entry.resolution, 30);
      const claim = typeof fact === "string" ? null : fact;
      const block = canonicalCanvasBlock(entry.canvas_block)
        ?? canonicalCanvasBlock(claim?.canvasBlock);
      const contradiction: TranscriptContradiction = {
        researchStatement: typeof fact === "string" ? fact : fact.statement,
        clientQuote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        resolution: RESOLUTIONS.has(resolution)
          ? resolution as TranscriptContradiction["resolution"]
          : "unresolved",
      };
      if (claim?.sourceUrl) contradiction.researchSourceUrl = claim.sourceUrl;
      if (block) contradiction.canvasBlock = block;
      return contradiction;
    })
    .filter((item): item is TranscriptContradiction => Boolean(item));

  const canvasUpdates = list(model.canvas_updates).slice(0, MAX_ITEMS)
    .map((item): CanvasUpdate | null => {
      const entry = record(item);
      if (!entry) return reject("canvas_update", "not-an-object", "");
      const block = canonicalCanvasBlock(entry.canvas_block);
      if (!block) return reject("canvas_update", "unknown-canvas-block", text(entry.canvas_block, 120));
      const grounded = groundOr("canvas_update", entry);
      if (!grounded) return null;
      const replaced = researchStatement("canvas_update.replaces", entry.replaces_research_statement);
      // A client-stated Canvas claim carries the client's own words, never the model's paraphrase.
      const update: CanvasUpdate = {
        canvasBlock: block,
        statement: grounded.quote,
        quote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        provenance: "client-stated",
      };
      if (replaced) update.replacesResearchStatement = typeof replaced === "string" ? replaced : replaced.statement;
      return update;
    })
    .filter((item): item is CanvasUpdate => Boolean(item));

  const flowConfirmations = list(model.flow_confirmations).slice(0, MAX_ITEMS)
    .map((item): FlowConfirmation | null => {
      const entry = record(item);
      if (!entry) return reject("flow_confirmation", "not-an-object", "");
      const flowStepId = text(entry.flow_step_id, 80);
      if (!flowIds.has(flowStepId)) {
        return reject("flow_confirmation", "unknown-flow-step", flowStepId || "(empty)");
      }
      const status = text(entry.status, 30);
      if (!FLOW_STATUSES.has(status)) {
        return reject("flow_confirmation", "unknown-flow-status", `${flowStepId}: ${status}`);
      }
      if (status === "unconfirmed") {
        return { flowStepId, status: "unconfirmed", quote: "", speaker: "", timestamp: "" };
      }
      const grounded = groundOr("flow_confirmation", entry);
      if (!grounded) return null;
      return {
        flowStepId,
        status: status as "confirmed" | "corrected",
        quote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
      };
    })
    .filter((item): item is FlowConfirmation => Boolean(item));

  /** An owner is a real person or nobody; an unverifiable name is blanked, never invented. */
  const ownerOf = (kind: string, raw: unknown, fallback: string): string => {
    const owner = text(raw, 120);
    if (!owner) return "";
    if (namedInTranscript(index, owner)) return owner;
    reject(kind, "person-not-in-transcript", owner);
    return fallback && namedInTranscript(index, fallback) ? fallback : "";
  };

  const decisions = list(model.decisions).slice(0, MAX_ITEMS)
    .map((item): TranscriptDecision | null => {
      const entry = record(item);
      if (!entry) return reject("decision", "not-an-object", "");
      const grounded = groundOr("decision", entry);
      if (!grounded) return null;
      return {
        decision: text(entry.decision, 240) || grounded.quote,
        quote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        owner: ownerOf("decision.owner", entry.owner, grounded.speaker),
      };
    })
    .filter((item): item is TranscriptDecision => Boolean(item));

  const tasks = list(model.tasks).slice(0, MAX_ITEMS)
    .map((item): TranscriptTask | null => {
      const entry = record(item);
      if (!entry) return reject("task", "not-an-object", "");
      const grounded = groundOr("task", entry);
      if (!grounded) return null;
      const flowStepId = text(entry.flow_step_id, 80);
      if (flowStepId && !flowIds.has(flowStepId)) {
        reject("task.flow_step", "unknown-flow-step", flowStepId);
      }
      const task: TranscriptTask = {
        task: text(entry.task, 240) || grounded.quote,
        quote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        owner: ownerOf("task.owner", entry.owner, ""),
      };
      if (flowStepId && flowIds.has(flowStepId)) task.flowStepId = flowStepId;
      return task;
    })
    .filter((item): item is TranscriptTask => Boolean(item));

  const roles = list(model.roles).slice(0, MAX_ROLES)
    .map((item): RoleMapEntry | null => {
      const entry = record(item);
      if (!entry) return reject("role", "not-an-object", "");
      const person = text(entry.person, 120);
      if (!person) return reject("role", "empty-person", "");
      if (!namedInTranscript(index, person)) return reject("role", "person-not-in-transcript", person);
      // A role claim is a claim about the client's operation, so it needs a client line behind it.
      const grounded = groundOr("role", entry);
      if (!grounded) return null;
      const reportsTo = text(entry.reports_to, 120);
      const judgment = text(entry.judgment_or_grind, 30);
      return {
        person,
        reportsTo: reportsTo && namedInTranscript(index, reportsTo) ? reportsTo : "",
        responsibilities: strings(entry.responsibilities, 160, 10),
        tasks: strings(entry.tasks, 240, 10),
        doesTask: entry.does_task === true,
        accountableForOutcome: entry.accountable_for_outcome === true,
        judgmentOrGrind: JUDGMENT_VALUES.has(judgment)
          ? judgment as RoleMapEntry["judgmentOrGrind"]
          : "mixed",
        approvalAuthority: text(entry.approval_authority, 240),
        singlePointDependency: entry.single_point_dependency === true,
      };
    })
    .filter((item): item is RoleMapEntry => Boolean(item));

  const unansweredQuestions = strings(model.unanswered_required_question_ids, 80, MAX_ITEMS)
    .map((id): DiscoveryQuestion | null => {
      if (questionsById.size === 0) return reject("unanswered_question", "no-question-catalog", id);
      const question = questionsById.get(id);
      if (!question) return reject("unanswered_question", "unknown-question-id", id);
      if (!question.required) return reject("unanswered_question", "question-not-required", id);
      return question;
    })
    .filter((item): item is DiscoveryQuestion => Boolean(item));

  const rejectedHypotheses = list(model.rejected_hypotheses).slice(0, 6)
    .map((item): RejectedHypothesis | null => {
      const entry = record(item);
      if (!entry) return reject("rejected_hypothesis", "not-an-object", "");
      const constraintType = text(entry.constraint_type, 30);
      if (!TYPES.has(constraintType)) {
        return reject("rejected_hypothesis", "unknown-constraint-type", constraintType || "(empty)");
      }
      const canvasBlock = canonicalCanvasBlock(entry.canvas_block);
      if (!canvasBlock) {
        return reject("rejected_hypothesis", "unknown-canvas-block", text(entry.canvas_block, 120));
      }
      const reason = text(entry.reason, 400);
      if (!reason) return reject("rejected_hypothesis", "empty-reason", constraintType);
      // A rival is only worth printing if the line that argues against it is real.
      const grounded = groundOr("rejected_hypothesis", entry);
      if (!grounded) return null;
      return {
        constraintType: constraintType as ConstraintType,
        canvasBlock,
        reason,
        quote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        line: grounded.line,
      };
    })
    .filter((item): item is RejectedHypothesis => Boolean(item))
    .slice(0, MAX_REJECTED_HYPOTHESES);

  const gaps = strings(model.gaps, 300, 15);

  return {
    quotes,
    metrics,
    contradictions,
    canvasUpdates,
    flowConfirmations,
    decisions,
    tasks,
    roles,
    narrative: text(model.narrative, 3_000),
    gaps,
    rejections,
    constraint: groundConstraint(model.constraint, {
      groundOr,
      reject,
      gaps,
      metrics,
      metricModelIndex,
    }),
    rejectedHypotheses,
    unansweredQuestions,
  };
}

type ConstraintGroundingContext = {
  groundOr: (kind: string, entry: Record<string, unknown>) => GroundedQuote | null;
  reject: (kind: string, reason: string, detail: string) => null;
  gaps: string[];
  metrics: ExtractedMetric[];
  metricModelIndex: number[];
};

/**
 * A constraint has to be about something the client said, in more than one place, with at
 * least one line explaining *how* throughput is limited.
 *
 * Audit F3: `evidence.length > 0` was the whole test, and a citation with no quote span
 * auto-grounded, so a capacity/Key Resources story was assembled from a whiteboard aside and
 * a question. Audit F4: the baseline was whatever number came first. Both are now decided
 * here, and a failure returns null with a gap saying why — never a quietly weakened finding.
 */
function groundConstraint(
  value: unknown,
  context: ConstraintGroundingContext,
): ModelConstraint | null {
  const { groundOr, reject, gaps, metrics, metricModelIndex } = context;
  const entry = record(value);
  if (!entry) return null;
  const constraintType = text(entry.constraint_type, 30);
  const canvasBlock = canonicalCanvasBlock(entry.canvas_block);
  if (!TYPES.has(constraintType)) return reject("constraint", "unknown-constraint-type", constraintType);
  if (!canvasBlock) return reject("constraint", "unknown-canvas-block", text(entry.canvas_block, 120));
  const type = constraintType as ConstraintType;

  const evidence = list(entry.evidence).slice(0, 8)
    .map((item): ConstraintCitation | null => {
      const citation = record(item);
      if (!citation) return reject("constraint_evidence", "not-an-object", "");
      const role = text(citation.role, 40).toLowerCase().replace(/[\s-]+/g, "_");
      if (!ROLES.has(role)) {
        return reject("constraint_evidence", "unknown-evidence-role", role || "(empty)");
      }
      const grounded = groundOr("constraint_evidence", citation);
      if (!grounded) return null;
      return { ...grounded, role: role as EvidenceRole };
    })
    .filter((item): item is ConstraintCitation => Boolean(item));

  const distinctLines = new Set(evidence.map((item) => item.line));
  if (distinctLines.size < MIN_CONSTRAINT_LINES) {
    gaps.push(
      `The model proposed a ${type} constraint at ${canvasBlock} on ${distinctLines.size} grounded client line(s). A constraint needs at least ${MIN_CONSTRAINT_LINES} distinct client-stated lines, so it was not carried into the finding.`,
    );
    return reject("constraint", "fewer-than-two-grounded-client-lines", text(entry.reasoning, 300));
  }
  if (!evidence.some((item) => item.role === "mechanism")) {
    gaps.push(
      `The model proposed a ${type} constraint at ${canvasBlock} with no mechanism citation — no client line saying how throughput is actually limited — so it was not carried into the finding. Symptoms alone do not locate a constraint.`,
    );
    return reject("constraint", "no-mechanism-citation", text(entry.reasoning, 300));
  }

  const baselineReason = text(entry.baseline_reason, 400);
  const nominated = Number(entry.baseline_metric_index);
  let baselineMetricIndex = -1;
  let baselineMetric: ExtractedMetric | null = null;
  if (Number.isInteger(nominated) && nominated >= 0) {
    const position = metricModelIndex.indexOf(nominated);
    const metric = position === -1 ? undefined : metrics[position];
    if (!metric) {
      reject("constraint.baseline", "baseline-metric-not-grounded", `index ${nominated}`);
    } else if (!metricCanConfirmBaseline(metric)) {
      reject("constraint.baseline", "baseline-metric-not-fully-grounded", `${metric.label}: ${metric.value}`);
    } else if (!dimensionMatchesConstraint(type, metric.unit, metric.period)) {
      reject(
        "constraint.baseline",
        "baseline-metric-dimension-mismatch",
        `${type} constraint against ${metric.value} (${metric.unit} per ${metric.period})`,
      );
    } else if (baselineReasonRequired(type) && !baselineReason) {
      reject("constraint.baseline", "baseline-reason-required", `${type} constraint`);
    } else {
      baselineMetricIndex = position;
      baselineMetric = metric;
    }
    if (!baselineMetric) {
      gaps.push(
        `The metric the model nominated as the baseline does not measure the ${type} constraint it was nominated for, so the baseline is recorded as Missing rather than reassigned.`,
      );
    }
  }

  return {
    constraintType: type,
    canvasBlock,
    reasoning: text(entry.reasoning, 1_200),
    symptomVsConstraint: text(entry.symptom_vs_constraint, 800),
    prescription: text(entry.prescription, 600),
    whySmallestIntervention: text(entry.why_smallest_intervention, 600),
    killCondition: text(entry.kill_condition, 400),
    predictedNextConstraint: text(entry.predicted_next_constraint, 400),
    evidence,
    baselineMetricIndex,
    baselineMetric,
    baselineReason,
  };
}
