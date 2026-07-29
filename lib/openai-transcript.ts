import {
  EVIDENCE_ROLES,
  findingStatusFor,
  groundModelSynthesis,
  pathDisagreementBetween,
  rejectedHypothesisAppendixItem,
  selectBaselineMetric,
  type FlowConfirmation,
  type GroundedSynthesis,
  type GroundedTranscriptQuote,
} from "./openai-transcript-schema";
import type { Credentials } from "./secrets";
import { baselineStatusFor } from "./transcript";
import {
  KILL_COMPARATORS,
  makeId,
  type CanvasUpdate,
  type ConstraintFinding,
  type ConstraintType,
  type DiscoveryQuestion,
  type EvidenceClaim,
  type ExtractedMetric,
  type ResearchSynthesis,
  type RoleMapEntry,
  type TranscriptContradiction,
  type TranscriptDecision,
  type TranscriptLine,
  type TranscriptSynthesis,
  type TranscriptTask,
  type ValueFlowStep,
} from "./workflow";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** Gaps the deterministic pass writes that a merged, larger evidence set can retire. */
const BASELINE_GAP = "Confirm one baseline metric with value, unit, period, source, and accountable owner.";
const NO_SIGNAL_GAP = "No client-stated constraint signal was found.";

type OpenAIResponse = {
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export type TranscriptModelInput = {
  lines: TranscriptLine[];
  client: string;
  callNumber: 1 | 2;
  transcriptUrl?: string;
  research?: ResearchSynthesis;
  canvas?: Record<string, EvidenceClaim[]>;
  valueFlow?: ValueFlowStep[];
  questions?: DiscoveryQuestion[];
  priorSynthesis?: TranscriptSynthesis[];
};

/**
 * The Worker binding and the research module that also reads it are imported lazily, so this
 * module — grounding rules, merge rules, retry policy — stays importable outside the Worker
 * runtime and can be tested directly under `node --test`. Nothing is read until a call is
 * actually about to be made, and with credentials no binding is touched at all.
 */
async function configuredValue(name: string, credentials?: Credentials): Promise<string> {
  if (credentials) return credentials.get(name).trim();
  const { env } = await import("cloudflare:workers");
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

export async function openAITranscriptConfigured(credentials?: Credentials): Promise<boolean> {
  return (await configuredValue("OPENAI_API_KEY", credentials)).length > 0;
}

export async function openAITranscriptModel(credentials?: Credentials): Promise<string> {
  const configured = await configuredValue("OPENAI_TRANSCRIPT_MODEL", credentials);
  if (configured) return configured;
  const { openAIResearchModel } = await import("./openai-research");
  return openAIResearchModel(credentials);
}

function outputText(response: OpenAIResponse): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .trim();
}

const CANVAS_BLOCK_ENUM = [
  "Key Partners", "Key Activities", "Key Resources", "Value Propositions",
  "Customer Relationships", "Channels", "Customer Segments",
  "Cost Structure", "Revenue Streams",
] as const;

const CONSTRAINT_TYPE_ENUM = ["capacity", "latency", "quality", "knowledge", "policy"] as const;

/**
 * Every citation is a line number plus the span of that line being relied on. A constraint
 * citation additionally says what job the line is doing. Without this a
 * constraint could be assembled entirely out of symptoms, which is how a wrong constraint
 * survived the audit: nothing had to explain *how* throughput was limited.
 */
const constraintCitation = {
  type: "object",
  additionalProperties: false,
  required: ["line", "quote", "role"],
  properties: {
    line: { type: "integer" },
    quote: { type: "string" },
    role: { type: "string", enum: EVIDENCE_ROLES },
  },
} as const;

const transcriptSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "narrative", "constraint", "rejected_hypotheses", "quotes", "metrics", "contradictions",
    "canvas_updates", "flow_confirmations", "decisions", "tasks", "roles",
    "unanswered_required_question_ids", "gaps",
  ],
  properties: {
    narrative: { type: "string" },
    constraint: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "constraint_type", "canvas_block", "reasoning", "symptom_vs_constraint",
        "prescription", "why_smallest_intervention", "kill_condition", "kill_condition_spec",
        "predicted_next_constraint", "evidence",
        "baseline_metric_index", "baseline_reason",
      ],
      properties: {
        constraint_type: { type: "string", enum: CONSTRAINT_TYPE_ENUM },
        canvas_block: { type: "string", enum: CANVAS_BLOCK_ENUM },
        reasoning: { type: "string" },
        symptom_vs_constraint: { type: "string" },
        prescription: { type: "string" },
        why_smallest_intervention: { type: "string" },
        kill_condition: { type: "string" },
        /**
         * The same stop condition in a shape the outcome screen can actually test. Every part
         * is required by the schema and every part may be `""`; an incomplete spec is dropped
         * whole, so the client's verbatim sentence is never padded with an invented threshold.
         */
        kill_condition_spec: {
          type: "object",
          additionalProperties: false,
          required: ["metric", "comparator", "threshold", "window"],
          properties: {
            metric: { type: "string" },
            comparator: { type: "string", enum: ["", ...KILL_COMPARATORS] },
            threshold: { type: "string" },
            window: { type: "string" },
          },
        },
        predicted_next_constraint: { type: "string" },
        evidence: { type: "array", items: constraintCitation },
        /** 0-based index into `metrics`, or -1 when no metric measures this constraint. */
        baseline_metric_index: { type: "integer" },
        baseline_reason: { type: "string" },
      },
    },
    rejected_hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["constraint_type", "canvas_block", "reason", "line", "quote"],
        properties: {
          constraint_type: { type: "string", enum: CONSTRAINT_TYPE_ENUM },
          canvas_block: { type: "string", enum: CANVAS_BLOCK_ENUM },
          reason: { type: "string" },
          line: { type: "integer" },
          quote: { type: "string" },
        },
      },
    },
    quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "quote", "reason"],
        properties: {
          line: { type: "integer" },
          quote: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    metrics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "line", "quote", "label", "value", "unit", "period",
          "unit_span", "period_span", "denominator_span",
        ],
        properties: {
          line: { type: "integer" },
          quote: { type: "string" },
          label: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          period: { type: "string" },
          /** The words of the cited line that say the unit. Empty when the client never said it. */
          unit_span: { type: "string" },
          /** The words of the cited line that say what the number is counted over. */
          period_span: { type: "string" },
          /** The words of the cited line that say what a percentage is out of. */
          denominator_span: { type: "string" },
        },
      },
    },
    contradictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["research_statement", "line", "quote", "resolution", "canvas_block"],
        properties: {
          research_statement: { type: "string" },
          line: { type: "integer" },
          quote: { type: "string" },
          resolution: {
            type: "string",
            enum: ["client-corrected", "client-confirmed", "unresolved"],
          },
          canvas_block: { type: "string" },
        },
      },
    },
    canvas_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["canvas_block", "line", "quote", "replaces_research_statement"],
        properties: {
          canvas_block: { type: "string", enum: CANVAS_BLOCK_ENUM },
          line: { type: "integer" },
          quote: { type: "string" },
          replaces_research_statement: { type: "string" },
        },
      },
    },
    flow_confirmations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["flow_step_id", "status", "line", "quote"],
        properties: {
          flow_step_id: { type: "string" },
          status: { type: "string", enum: ["confirmed", "corrected", "unconfirmed"] },
          line: { type: "integer" },
          quote: { type: "string" },
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "line", "quote", "owner"],
        properties: {
          decision: { type: "string" },
          line: { type: "integer" },
          quote: { type: "string" },
          owner: { type: "string" },
        },
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "line", "quote", "owner", "flow_step_id"],
        properties: {
          task: { type: "string" },
          line: { type: "integer" },
          quote: { type: "string" },
          owner: { type: "string" },
          flow_step_id: { type: "string" },
        },
      },
    },
    roles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "person", "reports_to", "responsibilities", "tasks", "does_task",
          "accountable_for_outcome", "judgment_or_grind", "approval_authority",
          "single_point_dependency", "line", "quote",
        ],
        properties: {
          person: { type: "string" },
          reports_to: { type: "string" },
          responsibilities: { type: "array", items: { type: "string" } },
          tasks: { type: "array", items: { type: "string" } },
          does_task: { type: "boolean" },
          accountable_for_outcome: { type: "boolean" },
          judgment_or_grind: { type: "string", enum: ["judgment", "grind", "mixed"] },
          approval_authority: { type: "string" },
          single_point_dependency: { type: "boolean" },
          line: { type: "integer" },
          quote: { type: "string" },
        },
      },
    },
    unanswered_required_question_ids: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
  },
} as const;

const INSTRUCTIONS = [
  "You are analysing a recorded client call for a live advisor-led throughput audit.",
  "The transcript is supplied as numbered lines: `<n> [timestamp] <speaker> (<provenance>): <text>`.",
  "Cite evidence by the line number `n` plus the exact span of that line you rely on; the span must be copied character-for-character from that line.",
  "Only lines marked client-stated may be cited. Advisor-note and gap lines are context only and can never become client evidence.",
  "Never invent a number, a quote, a name, a date, a baseline, a system, or a person. If the client did not say something, do not write it; say so in gaps instead.",
  "Reason across turns and through paraphrase: an implied dependency, a hedge, or an answer given three turns later still counts, but it must be cited to the line that carries it.",
  "Distinguish a symptom from the constraint. Slow delivery is a symptom; the single place where throughput is actually limited is the constraint. Explain which is which in symptom_vs_constraint.",
  "Treat hedged or conditional statements (\"it depends on whether Dave is around\", \"usually\", \"I think\") as hedges, not facts: keep them as evidence, name the hedge in the quote reason, and add the unconfirmed part to gaps.",
  "metrics: only numbers the client actually said. The value must appear literally in the cited line, and so must the unit and the period: copy unit_span and period_span character-for-character out of that same line. Every property is required, but an empty string is always a valid answer — if the client never said the unit or never said what the number is counted over, return \"\" for that field and for its span rather than supplying one. A metric with an empty or ungrounded unit or period is kept as evidence and marked partial; it can never confirm a baseline, which is the correct outcome, so never fill one in to make the metric look complete.",
  "metrics: when the unit is a percentage, denominator_span must be the span of the cited line saying what the percentage is out of (\"of what we quote\", \"of jobs\"). A percentage with no client-stated denominator is not a measurement; leave it empty and let the metric stay partial.",
  "constraint.evidence: every citation carries a role — symptom (what hurts), mechanism (how throughput is actually limited), magnitude (how big it is), or single_point_dependency (one person or step is the only path). A constraint needs at least two distinct client-stated lines and at least one mechanism citation; without a mechanism citation, return null for constraint and say why in gaps.",
  "constraint.baseline_metric_index: the 0-based index into your own metrics array of the one metric that measures this constraint, or -1 if none does. It must match the constraint's dimension — latency is measured in time, capacity in a count over a period, quality as a rate. baseline_reason says why that metric measures this constraint, and is required for knowledge and policy constraints.",
  "constraint.kill_condition_spec: the same stop condition as a test — metric is the BUSINESS number the constraint was supposed to move (not the operational metric being worked on), comparator is one of increases/decreases/reaches/does-not-move, threshold is how far it had to move in the client's own terms, window is how long it is watched for. Fill it in only from what the client actually committed to; if any part was never said, return \"\" for every field and let the verbatim kill_condition carry the condition alone. A window nobody agreed to is an invented commitment.",
  "rejected_hypotheses: the two strongest rival readings of this same call that you considered and did not choose, each with the constraint type, the Canvas block, why it was rejected, and the client line that argues against it. Cite that line the same way as any other citation; an ungrounded rival is discarded. If you cannot name a rival with a real client line against it, return an empty array rather than inventing one.",
  "contradictions: research_statement must be copied verbatim from the supplied research facts; never contradict a claim that was not supplied.",
  "canvas_updates: only where a client line changes or confirms what a Canvas block says.",
  "flow_confirmations: use the supplied flow step ids only. Use unconfirmed with no citation when the client never covered the step.",
  "roles: one entry per person actually named in the transcript or in the traced flow, each with a citation. singlePointDependency is true when the client indicates one person is the only path for a step, however indirectly they phrase it.",
  "unanswered_required_question_ids: ids of required discovery questions the client did not answer anywhere in the call.",
  "narrative: at most 150 words of your own reading of the call. It is advisor interpretation, never client evidence, and must contain no invented facts.",
  "Return empty strings and empty arrays rather than omitting any property. Return null for constraint when no client line supports one.",
].join(" ");

function renderLines(lines: TranscriptLine[]): string {
  return lines
    .map((line, index) =>
      `${index + 1} [${line.timestamp}] ${line.speaker} (${line.provenance}): ${line.text}`)
    .join("\n");
}

function priorSummary(prior: TranscriptSynthesis[]): Array<Record<string, unknown>> {
  return prior.map((entry) => ({
    call_number: entry.callNumber,
    baseline_status: entry.baselineStatus,
    constraint_type: entry.constraintCandidate?.constraintType ?? "",
    canvas_block: entry.constraintCandidate?.canvasBlock ?? "",
    finding_status: entry.constraintCandidate?.findingStatus ?? "",
    metrics: (entry.metrics ?? []).map((metric) => `${metric.label}: ${metric.value}`),
    gaps: entry.gaps ?? [],
  }));
}

/**
 * A provider failure worth trying again: the request never got a considered answer. A 4xx, a
 * malformed body, or a payload that does not parse means asking again would only produce the
 * same reply more slowly, so those fail straight through to the deterministic reading.
 */
class RetryableProviderError extends Error {}

const RETRY_BACKOFF_MS = 400;

function retryable(error: unknown): boolean {
  if (error instanceof RetryableProviderError) return true;
  // AbortSignal.timeout raises TimeoutError; a dropped connection raises TypeError.
  const name = (error as { name?: string } | null)?.name ?? "";
  return name === "TimeoutError" || name === "AbortError" || error instanceof TypeError;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function synthesizeTranscriptWithOpenAI(
  base: TranscriptSynthesis,
  input: TranscriptModelInput,
  fetcher: typeof fetch = fetch,
  credentials?: Credentials,
): Promise<TranscriptSynthesis> {
  const key = await configuredValue("OPENAI_API_KEY", credentials);
  if (!key) {
    return { ...base, analysisMode: "deterministic", modelStatus: "not-configured" };
  }
  const model = await openAITranscriptModel(credentials);

  const valueFlow = input.valueFlow ?? input.research?.valueFlow ?? [];
  const questions = input.questions ?? input.research?.discoveryQuestions ?? [];

  const request = async (): Promise<unknown> => {
    const response = await fetcher(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 16_000,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "tier4_transcript_synthesis",
            strict: true,
            schema: transcriptSchema,
          },
        },
        input: [
          { role: "developer", content: [{ type: "input_text", text: INSTRUCTIONS }] },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  client: input.client,
                  call_number: input.callNumber,
                  research_summary: input.research?.description ?? "",
                  research_facts: (input.research?.facts ?? []).map((fact) => ({
                    statement: fact.statement,
                    canvas_block: fact.canvasBlock ?? "",
                    source_url: fact.sourceUrl ?? "",
                    provenance: fact.provenance,
                  })),
                  research_gaps: input.research?.gaps ?? [],
                  canvas: Object.entries(input.canvas ?? {}).map(([block, claims]) => ({
                    canvas_block: block,
                    claims: (claims ?? []).map((claim) => ({
                      statement: claim.statement,
                      provenance: claim.provenance,
                    })),
                  })),
                  value_flow: valueFlow.map((step) => ({
                    id: step.id,
                    order: step.order,
                    name: step.name,
                    description: step.description,
                    actor: step.actor,
                    system: step.system,
                    evidence_status: step.evidenceStatus,
                    confirmation_question: step.confirmationQuestion,
                  })),
                  discovery_questions: questions.map((question) => ({
                    id: question.id,
                    section: question.section,
                    question: question.question,
                    required: question.required,
                    expected_answer_type: question.expectedAnswerType,
                  })),
                  prior_calls: priorSummary(input.priorSynthesis ?? []),
                  transcript: renderLines(input.lines),
                }),
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json().catch(() => ({})) as OpenAIResponse;
    if (!response.ok) {
      const message = body.error?.message || `OpenAI returned HTTP ${response.status}.`;
      // 5xx and 429 are the provider having a moment; 4xx is us, and repeating it is pointless.
      if (response.status >= 500 || response.status === 429) throw new RetryableProviderError(message);
      throw new Error(message);
    }
    const rawText = outputText(body);
    // An empty completion is a truncated or dropped response, not a considered refusal.
    if (!rawText) throw new RetryableProviderError("OpenAI returned no transcript synthesis text.");
    // Deliberately NOT retryable: the model answered, and the answer did not fit the schema.
    return JSON.parse(rawText) as unknown;
  };

  let payload: unknown;
  try {
    payload = await request();
  } catch (first) {
    if (!retryable(first)) {
      return { ...base, analysisMode: "deterministic", modelStatus: "failed", providerModel: model };
    }
    await pause(RETRY_BACKOFF_MS);
    try {
      payload = await request();
    } catch {
      return { ...base, analysisMode: "deterministic", modelStatus: "failed", providerModel: model };
    }
  }

  try {
    const grounded = groundModelSynthesis(
      payload,
      input.lines,
      valueFlow,
      { facts: input.research?.facts ?? [], questions },
    );
    return { ...merge(base, grounded, input), providerModel: model };
  } catch {
    return {
      ...base,
      analysisMode: "deterministic",
      modelStatus: "failed",
      providerModel: model,
    };
  }
}

/* ----------------------------------------------------------------- merge */

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function dedupe<T>(items: T[], key: (item: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out.slice(0, limit);
}

function firstNumber(value: string): string {
  return value.match(/\d[\d,]*(?:\.\d+)?%?/)?.[0] ?? "";
}

/** Union of two role readings: a claim from either pass is kept, and a disagreement stays unclassified. */
function mergeRole(base: RoleMapEntry, model: RoleMapEntry): RoleMapEntry {
  return {
    person: base.person,
    reportsTo: base.reportsTo || model.reportsTo,
    responsibilities: [...new Set([...base.responsibilities, ...model.responsibilities])],
    tasks: [...new Set([...base.tasks, ...model.tasks])],
    doesTask: base.doesTask || model.doesTask,
    accountableForOutcome: base.accountableForOutcome || model.accountableForOutcome,
    judgmentOrGrind: base.judgmentOrGrind === model.judgmentOrGrind
      ? base.judgmentOrGrind
      : base.judgmentOrGrind === "mixed"
        ? model.judgmentOrGrind
        : model.judgmentOrGrind === "mixed" ? base.judgmentOrGrind : "mixed",
    approvalAuthority: base.approvalAuthority || model.approvalAuthority,
    singlePointDependency: base.singlePointDependency || model.singlePointDependency,
  };
}

function mergeFlowConfirmations(
  base: FlowConfirmation[],
  model: FlowConfirmation[],
): FlowConfirmation[] {
  const byStep = new Map<string, FlowConfirmation>();
  for (const item of base) byStep.set(item.flowStepId, item);
  for (const item of model) {
    const existing = byStep.get(item.flowStepId);
    // An unconfirmed reading never overwrites a grounded one, from either pass.
    if (existing && item.status === "unconfirmed") continue;
    byStep.set(item.flowStepId, item);
  }
  return [...byStep.values()];
}

function existingCanvasClaims(canvas?: Record<string, EvidenceClaim[]>): Set<string> {
  const existing = new Set<string>();
  for (const claims of Object.values(canvas ?? {})) {
    for (const claim of claims ?? []) {
      if (claim?.provenance === "client-stated" && typeof claim.statement === "string") {
        existing.add(normalizeKey(claim.statement));
      }
    }
  }
  return existing;
}

/**
 * Union, never replace: each pass catches things the other misses. Only the constraint candidate
 * is a single-winner decision, and there the model wins because it reasons about symptom versus
 * cause — with the disagreement written into `gaps` so the advisor decides, not the model.
 */
function merge(
  base: TranscriptSynthesis,
  grounded: GroundedSynthesis,
  input: TranscriptModelInput,
): TranscriptSynthesis {
  const quotes = dedupe<GroundedTranscriptQuote>(
    [...base.quotes, ...grounded.quotes],
    (quote) => `${quote.timestamp}|${normalizeKey(quote.text)}`,
    12,
  );
  const metrics = dedupe<ExtractedMetric>(
    [...base.metrics, ...grounded.metrics],
    (metric) => `${metric.timestamp}|${normalizeKey(metric.value)}|${metric.unit}|${metric.period}`,
    25,
  );
  // Governance rule, unchanged: the baseline is whatever the grounded metrics support, nothing else.
  const baselineStatus = baselineStatusFor(metrics);

  const contradictions = dedupe<TranscriptContradiction>(
    [...(base.contradictions ?? []), ...grounded.contradictions],
    (item) => `${normalizeKey(item.researchStatement)}|${item.timestamp}|${normalizeKey(item.clientQuote)}`,
    25,
  );
  const decisions = dedupe<TranscriptDecision>(
    [...(base.decisions ?? []), ...grounded.decisions],
    (item) => `${item.timestamp}|${normalizeKey(item.quote)}`,
    25,
  );
  const tasks = dedupe<TranscriptTask>(
    [...(base.tasks ?? []), ...grounded.tasks],
    (item) => `${item.timestamp}|${normalizeKey(item.quote)}`,
    25,
  );
  const alreadyOnCanvas = existingCanvasClaims(input.canvas);
  const canvasUpdates = dedupe<CanvasUpdate>(
    [...(base.canvasUpdates ?? []), ...grounded.canvasUpdates],
    (item) => `${item.canvasBlock}|${normalizeKey(item.statement)}`,
    25,
  ).filter((item) => !alreadyOnCanvas.has(normalizeKey(item.statement)));
  const flowConfirmations = mergeFlowConfirmations(
    base.flowConfirmations ?? [],
    grounded.flowConfirmations,
  );

  const roles: RoleMapEntry[] = [];
  const roleIndex = new Map<string, number>();
  for (const role of [...(base.roles ?? []), ...grounded.roles]) {
    const key = normalizeKey(role.person);
    const at = roleIndex.get(key);
    if (at === undefined) {
      roleIndex.set(key, roles.length);
      roles.push(role);
      continue;
    }
    roles[at] = mergeRole(roles[at], role);
  }

  const priorTypes = new Set(
    (input.priorSynthesis ?? [])
      .map((entry) => entry?.constraintCandidate?.constraintType)
      .filter((type): type is ConstraintType => Boolean(type)),
  );
  const baseCandidate = base.constraintCandidate;
  const chosenType = grounded.constraint?.constraintType ?? baseCandidate?.constraintType ?? null;
  const priorConflict = chosenType !== null && [...priorTypes].some((type) => type !== chosenType);

  /**
   * The two passes read the same transcript. When they land on different constraints — or on
   * the same constraint in different parts of the business — the advisor has a decision to
   * make, and nothing downstream may treat the reading as settled. Audit F5: the comment here
   * already promised this; the code computed `verified` without it.
   */
  const pathDisagreement = pathDisagreementBetween(baseCandidate, grounded.constraint);
  const disagrees = pathDisagreement !== null;

  // The baseline must both be confirmed and measure the constraint it is attached to.
  const boundBaseline = chosenType
    ? grounded.constraint?.baselineMetric ?? selectBaselineMetric(metrics, chosenType)
    : null;
  const findingStatus = findingStatusFor({
    baselineStatus,
    baselineMetric: boundBaseline,
    callNumber: input.callNumber,
    priorConflict,
    pathDisagreement,
  });
  const verified = findingStatus === "client-verified";

  const gaps = [...base.gaps];
  const rivalItems = grounded.rejectedHypotheses.map(rejectedHypothesisAppendixItem);
  let constraintCandidate = baseCandidate;

  if (grounded.constraint) {
    // On disagreement the deterministic evidence argues for a different constraint, so it is not
    // carried into the model's finding; the conflict is surfaced as a gap instead.
    const evidence = dedupe(
      [
        ...grounded.constraint.evidence.map((item) => ({
          quote: item.quote,
          speaker: item.speaker,
          timestamp: item.timestamp,
          transcriptUrl: input.transcriptUrl ?? "",
          provenance: "client-stated" as const,
        })),
        ...(disagrees ? [] : baseCandidate?.evidence ?? []),
      ],
      (item) => `${item.timestamp}|${normalizeKey(item.quote)}`,
      8,
    );
    constraintCandidate = {
      constraintId: baseCandidate?.constraintId ?? makeId("con"),
      client: input.client,
      canvasBlock: grounded.constraint.canvasBlock,
      constraintType: grounded.constraint.constraintType,
      findingStatus: verified ? "client-verified" : "provisional",
      symptoms: evidence.map((item) => ({ statement: item.quote, number: firstNumber(item.quote) })),
      evidence,
      baselineMetric: baselineMetricFor(boundBaseline),
      prescription: {
        description: grounded.constraint.prescription
          || baseCandidate?.prescription.description
          || "",
        whySmallestIntervention: grounded.constraint.whySmallestIntervention
          || baseCandidate?.prescription.whySmallestIntervention
          || "It acts only on the currently evidenced constraint and keeps a named human accountable.",
      },
      projectedDelta: projectedDeltaFor(boundBaseline),
      baselineInstrumentation: baselineInstrumentationFor(boundBaseline),
      humanOwner: baseCandidate?.humanOwner ?? { name: "", role: "" },
      predictedNextConstraint: grounded.constraint.predictedNextConstraint
        || "Reassess after the intervention; do not infer the next constraint before measurement.",
      killCondition: grounded.constraint.killCondition
        || `Client evidence or measurements show ${grounded.constraint.constraintType} is not limiting throughput.`,
      // Additive: present only when all four parts were read out honestly. The prior
      // candidate's spec is kept when this pass could not derive one, never overwritten by
      // a blank — and never synthesised from the sentence above.
      ...(grounded.constraint.killConditionSpec
        ? { killConditionSpec: grounded.constraint.killConditionSpec }
        : baseCandidate?.killConditionSpec
          ? { killConditionSpec: baseCandidate.killConditionSpec }
          : {}),
      // The rivals the model examined and rejected, ahead of anything the deterministic pass
      // had already parked. This list was structurally empty before (audit F3).
      appendixItems: dedupe(
        [...rivalItems, ...(baseCandidate?.appendixItems ?? [])],
        (item) => normalizeKey(item),
        8,
      ),
    };
    if (pathDisagreement) {
      gaps.push(
        `The model reads this call as a ${pathDisagreement.model.constraintType} constraint at ${pathDisagreement.model.canvasBlock} while the deterministic pass read it as ${pathDisagreement.deterministic.constraintType} at ${pathDisagreement.deterministic.canvasBlock}; the model's reading is shown and the finding stays provisional until the advisor resolves the disagreement.`,
      );
    }
  } else if (baseCandidate) {
    constraintCandidate = {
      ...baseCandidate,
      findingStatus: verified ? "client-verified" : "provisional",
      baselineMetric: baselineMetricFor(boundBaseline),
      projectedDelta: projectedDeltaFor(boundBaseline),
      baselineInstrumentation: baselineInstrumentationFor(boundBaseline),
      appendixItems: dedupe(
        [...rivalItems, ...baseCandidate.appendixItems],
        (item) => normalizeKey(item),
        8,
      ),
    };
  }

  for (const question of grounded.unansweredQuestions) {
    gaps.push(`Required discovery question unanswered (${question.section}): ${question.question}`);
  }
  gaps.push(...grounded.gaps);
  if (grounded.rejections.length > 0) {
    gaps.push(
      `${grounded.rejections.length} model claim(s) failed transcript grounding and were dropped; see the grounding rejections list.`,
    );
  }

  const narrative = [
    grounded.narrative,
    grounded.constraint?.symptomVsConstraint
      ? `Symptom vs constraint: ${grounded.constraint.symptomVsConstraint}`
      : "",
    grounded.constraint?.reasoning ? `Reasoning: ${grounded.constraint.reasoning}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    ...base,
    quotes,
    metrics,
    baselineStatus,
    gaps: dedupe(
      gaps.filter((gap) =>
        (baselineStatus !== "Confirmed" || gap !== BASELINE_GAP) &&
        (!constraintCandidate || gap !== NO_SIGNAL_GAP)),
      (gap) => normalizeKey(gap),
      40,
    ),
    constraintCandidate,
    contradictions,
    decisions,
    tasks,
    canvasUpdates,
    flowConfirmations,
    roles,
    analysisMode: "model-assisted",
    modelStatus: "used",
    ...(narrative ? { narrative } : {}),
    ...(grounded.rejections.length > 0 ? { groundingRejections: grounded.rejections } : {}),
    ...(pathDisagreement ? { pathDisagreement } : {}),
  };
}

/**
 * The baseline is the metric that was validated against the constraint, or nothing. There is
 * no "closest available number" fallback — that is how monthly enquiry volume became the
 * baseline for a latency constraint (audit F4).
 */
function baselineMetricFor(metric: ExtractedMetric | null): ConstraintFinding["baselineMetric"] {
  if (!metric) return { name: "", value: "", unit: "", period: "", source: "Missing" };
  return {
    name: metric.label,
    value: metric.value,
    unit: metric.unit,
    period: metric.period,
    source: `${metric.speaker} at ${metric.timestamp}: ${metric.quote}`,
  };
}

function projectedDeltaFor(metric: ExtractedMetric | null): ConstraintFinding["projectedDelta"] {
  return {
    formula: "ending metric - starting metric",
    namedInputs: ["confirmed starting metric", "measured ending metric", "measurement period"],
    low: "",
    base: "",
    high: "",
    confidence: metric
      ? "Awaiting measured result"
      : "Blocked by missing baseline",
  };
}

function baselineInstrumentationFor(
  metric: ExtractedMetric | null,
): ConstraintFinding["baselineInstrumentation"] {
  const confirmed = metric !== null;
  return {
    required: !confirmed,
    firstSprintTask: confirmed
      ? ""
      : "Name the metric owner and capture the starting metric in the live workflow before intervention.",
    measurementClockStartsWhen: "The named owner records and confirms the starting metric.",
  };
}
