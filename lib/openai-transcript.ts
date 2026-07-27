import { env } from "cloudflare:workers";
import { openAIResearchModel } from "./openai-research";
import {
  groundModelSynthesis,
  type FlowConfirmation,
  type GroundedSynthesis,
  type GroundedTranscriptQuote,
} from "./openai-transcript-schema";
import type { Credentials } from "./secrets";
import { baselineStatusFor } from "./transcript";
import {
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

function bindings(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

/** With credentials the resolver owns precedence (server secret wins); without, env only. */
function configuredValue(name: string, credentials?: Credentials): string {
  if (credentials) return credentials.get(name).trim();
  const value = bindings()[name];
  return typeof value === "string" ? value.trim() : "";
}

export function openAITranscriptConfigured(credentials?: Credentials): boolean {
  return configuredValue("OPENAI_API_KEY", credentials).length > 0;
}

export function openAITranscriptModel(credentials?: Credentials): string {
  return configuredValue("OPENAI_TRANSCRIPT_MODEL", credentials)
    || openAIResearchModel(credentials);
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

/** Every citation is a line number plus the span of that line being relied on. */
const citation = {
  type: "object",
  additionalProperties: false,
  required: ["line", "quote"],
  properties: {
    line: { type: "integer" },
    quote: { type: "string" },
  },
} as const;

const transcriptSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "narrative", "constraint", "quotes", "metrics", "contradictions", "canvas_updates",
    "flow_confirmations", "decisions", "tasks", "roles",
    "unanswered_required_question_ids", "gaps",
  ],
  properties: {
    narrative: { type: "string" },
    constraint: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "constraint_type", "canvas_block", "reasoning", "symptom_vs_constraint",
        "prescription", "why_smallest_intervention", "kill_condition",
        "predicted_next_constraint", "evidence",
      ],
      properties: {
        constraint_type: {
          type: "string",
          enum: ["capacity", "latency", "quality", "knowledge", "policy"],
        },
        canvas_block: { type: "string", enum: CANVAS_BLOCK_ENUM },
        reasoning: { type: "string" },
        symptom_vs_constraint: { type: "string" },
        prescription: { type: "string" },
        why_smallest_intervention: { type: "string" },
        kill_condition: { type: "string" },
        predicted_next_constraint: { type: "string" },
        evidence: { type: "array", items: citation },
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
        required: ["line", "quote", "label", "value", "unit", "period"],
        properties: {
          line: { type: "integer" },
          quote: { type: "string" },
          label: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          period: { type: "string" },
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
  "metrics: only numbers the client actually said. The value must appear literally in the cited line. Leave unit or period empty rather than guessing them.",
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

export async function synthesizeTranscriptWithOpenAI(
  base: TranscriptSynthesis,
  input: TranscriptModelInput,
  fetcher: typeof fetch = fetch,
  credentials?: Credentials,
): Promise<TranscriptSynthesis> {
  const key = configuredValue("OPENAI_API_KEY", credentials);
  const model = openAITranscriptModel(credentials);
  if (!key) {
    return { ...base, analysisMode: "deterministic", modelStatus: "not-configured" };
  }

  const valueFlow = input.valueFlow ?? input.research?.valueFlow ?? [];
  const questions = input.questions ?? input.research?.discoveryQuestions ?? [];

  try {
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
    const body = await response.json() as OpenAIResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `OpenAI returned HTTP ${response.status}.`);
    }
    const rawText = outputText(body);
    if (!rawText) throw new Error("OpenAI returned no transcript synthesis text.");
    const grounded = groundModelSynthesis(
      JSON.parse(rawText) as unknown,
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
  // Verification still requires call 2 AND a confirmed baseline; the model cannot grant it.
  const verified = baselineStatus === "Confirmed" && input.callNumber === 2 && !priorConflict;

  const gaps = [...base.gaps];
  let constraintCandidate = baseCandidate;

  if (grounded.constraint) {
    const disagrees = Boolean(
      baseCandidate && baseCandidate.constraintType !== grounded.constraint.constraintType,
    );
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
      baselineMetric: baselineMetricFor(metrics, baselineStatus),
      prescription: {
        description: grounded.constraint.prescription
          || baseCandidate?.prescription.description
          || "",
        whySmallestIntervention: grounded.constraint.whySmallestIntervention
          || baseCandidate?.prescription.whySmallestIntervention
          || "It acts only on the currently evidenced constraint and keeps a named human accountable.",
      },
      projectedDelta: projectedDeltaFor(baselineStatus),
      baselineInstrumentation: baselineInstrumentationFor(baselineStatus),
      humanOwner: baseCandidate?.humanOwner ?? { name: "", role: "" },
      predictedNextConstraint: grounded.constraint.predictedNextConstraint
        || "Reassess after the intervention; do not infer the next constraint before measurement.",
      killCondition: grounded.constraint.killCondition
        || `Client evidence or measurements show ${grounded.constraint.constraintType} is not limiting throughput.`,
      appendixItems: baseCandidate?.appendixItems ?? [],
    };
    if (disagrees && baseCandidate) {
      gaps.push(
        `The model reads this call as a ${grounded.constraint.constraintType} constraint while the deterministic pass read it as ${baseCandidate.constraintType}; the model's reading is shown and the finding stays provisional until the advisor resolves the disagreement.`,
      );
    }
  } else if (baseCandidate) {
    constraintCandidate = {
      ...baseCandidate,
      findingStatus: verified ? "client-verified" : "provisional",
      baselineMetric: baselineMetricFor(metrics, baselineStatus),
      projectedDelta: projectedDeltaFor(baselineStatus),
      baselineInstrumentation: baselineInstrumentationFor(baselineStatus),
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
  };
}

function baselineMetricFor(
  metrics: ExtractedMetric[],
  baselineStatus: TranscriptSynthesis["baselineStatus"],
): ConstraintFinding["baselineMetric"] {
  const metric = metrics.find((item) => item.period && /\d/.test(item.value)) ?? metrics[0];
  const confirmed = baselineStatus === "Confirmed";
  return {
    name: metric?.label ?? "",
    value: confirmed ? metric?.value ?? "" : "",
    unit: confirmed ? metric?.unit ?? "" : "",
    period: confirmed ? metric?.period ?? "" : "",
    source: metric ? `${metric.speaker} at ${metric.timestamp}: ${metric.quote}` : "Missing",
  };
}

function projectedDeltaFor(
  baselineStatus: TranscriptSynthesis["baselineStatus"],
): ConstraintFinding["projectedDelta"] {
  return {
    formula: "ending metric - starting metric",
    namedInputs: ["confirmed starting metric", "measured ending metric", "measurement period"],
    low: "",
    base: "",
    high: "",
    confidence: baselineStatus === "Confirmed"
      ? "Awaiting measured result"
      : "Blocked by missing baseline",
  };
}

function baselineInstrumentationFor(
  baselineStatus: TranscriptSynthesis["baselineStatus"],
): ConstraintFinding["baselineInstrumentation"] {
  const confirmed = baselineStatus === "Confirmed";
  return {
    required: !confirmed,
    firstSprintTask: confirmed
      ? ""
      : "Name the metric owner and capture the starting metric in the live workflow before intervention.",
    measurementClockStartsWhen: "The named owner records and confirms the starting metric.",
  };
}
