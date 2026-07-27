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

/* ------------------------------------------------------------------ types */

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

export type ModelConstraint = {
  constraintType: ConstraintType;
  canvasBlock: CanvasBlock;
  reasoning: string;
  symptomVsConstraint: string;
  prescription: string;
  whySmallestIntervention: string;
  killCondition: string;
  predictedNextConstraint: string;
  evidence: GroundedQuote[];
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
  unansweredQuestions: DiscoveryQuestion[];
};

/* ---------------------------------------------------------------- helpers */

const MAX_ITEMS = 25;
const MAX_ROLES = 12;
const MAX_REJECTIONS = 60;
const MAX_QUOTE = 1_000;

const RESOLUTIONS = new Set<string>(["client-corrected", "client-confirmed", "unresolved"]);
const FLOW_STATUSES = new Set<string>(["confirmed", "corrected", "unconfirmed"]);
const JUDGMENT_VALUES = new Set<string>(["judgment", "grind", "mixed"]);
const TYPES = new Set<string>(CONSTRAINT_TYPES);

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
    if (!quote) return { ok: true, value: groundedFrom(index, position) };
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

  const metrics = list(model.metrics).slice(0, MAX_ITEMS)
    .map((item): ExtractedMetric | null => {
      const entry = record(item);
      if (!entry) return reject("metric", "not-an-object", "");
      const value = text(entry.value, 60);
      if (!value) return reject("metric", "empty-value", text(entry.label, 120));
      const grounded = groundOr("metric", entry);
      if (!grounded) return null;
      // The number has to be in the client's own line, not only in the model's rendering of it.
      if (!valueAppearsInLine(value, lines[grounded.line - 1].text)) {
        return reject("metric", "value-not-in-matched-line", `${value} | ${grounded.quote}`);
      }
      return {
        label: text(entry.label, 120) || "Client-stated metric",
        value,
        quote: grounded.quote,
        speaker: grounded.speaker,
        timestamp: grounded.timestamp,
        unit: text(entry.unit, 60).toLowerCase(),
        period: text(entry.period, 60).toLowerCase(),
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
    gaps: strings(model.gaps, 300, 15),
    rejections,
    constraint: groundConstraint(model.constraint, groundOr, reject),
    unansweredQuestions,
  };
}

function groundConstraint(
  value: unknown,
  groundOr: (kind: string, entry: Record<string, unknown>) => GroundedQuote | null,
  reject: (kind: string, reason: string, detail: string) => null,
): ModelConstraint | null {
  const entry = record(value);
  if (!entry) return null;
  const constraintType = text(entry.constraint_type, 30);
  const canvasBlock = canonicalCanvasBlock(entry.canvas_block);
  const evidence = list(entry.evidence).slice(0, 8)
    .map((item): GroundedQuote | null => {
      const citation = record(item);
      if (!citation) return reject("constraint_evidence", "not-an-object", "");
      return groundOr("constraint_evidence", citation);
    })
    .filter((item): item is GroundedQuote => Boolean(item));
  if (!TYPES.has(constraintType)) return reject("constraint", "unknown-constraint-type", constraintType);
  if (!canvasBlock) return reject("constraint", "unknown-canvas-block", text(entry.canvas_block, 120));
  // A constraint with nothing the client actually said behind it is exactly what must not ship.
  if (evidence.length === 0) return reject("constraint", "no-grounded-evidence", text(entry.reasoning, 300));
  return {
    constraintType: constraintType as ConstraintType,
    canvasBlock,
    reasoning: text(entry.reasoning, 1_200),
    symptomVsConstraint: text(entry.symptom_vs_constraint, 800),
    prescription: text(entry.prescription, 600),
    whySmallestIntervention: text(entry.why_smallest_intervention, 600),
    killCondition: text(entry.kill_condition, 400),
    predictedNextConstraint: text(entry.predicted_next_constraint, 400),
    evidence,
  };
}
