import {
  DISCOVERY_SECTIONS,
  canonicalCanvasBlock,
  type ConstraintHypothesis,
  type ConstraintType,
  type DiscoveryQuestion,
  type DiscoverySection,
  type EvidenceClaim,
  type ValueFlowStep,
} from "./workflow";

const CANVAS_BLOCKS = new Set([
  "Key Partners",
  "Key Activities",
  "Key Resources",
  "Value Propositions",
  "Customer Relationships",
  "Channels",
  "Customer Segments",
  "Cost Structure",
  "Revenue Streams",
]);

const CONSTRAINT_TYPES = new Set<ConstraintType>([
  "capacity",
  "latency",
  "quality",
  "knowledge",
  "policy",
]);

/** Research can only ever produce non-client evidence; "client-stated" and "doc" are unreachable here. */
type ResearchEvidenceStatus = ValueFlowStep["evidenceStatus"];

const RESEARCH_EVIDENCE_STATUSES = new Set<string>(["public-research", "advisor-note", "gap"]);
const ANSWER_TYPES = new Set<string>(["narrative", "number", "person", "choice"]);
const SECTIONS = new Set<string>(DISCOVERY_SECTIONS);

const MAX_FLOW_STEPS = 12;
const MAX_DISCOVERY_QUESTIONS = 24;

type ParsedOpenAIResearch = {
  summary: string;
  facts: EvidenceClaim[];
  gaps: string[];
  constraintHypotheses: ConstraintHypothesis[];
  valueFlow: ValueFlowStep[];
  discoveryQuestions: DiscoveryQuestion[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function canonicalSource(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    // Kept in step with validatePublicUrl in research.ts: link-local / cloud-metadata /
    // unspecified / IPv6-literal targets are rejected here too, so the two allow-lists cannot
    // drift. Defense in depth — a retained source URL is only ever rendered, never fetched.
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      host === "localhost" ||
      host === "localhost.localdomain" ||
      host === "metadata.google.internal" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.includes(":") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return "";
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return "";
  }
}

/** Returns the original URL only when its canonical form was actually cited by web search. */
function allowedSourceUrl(value: unknown, acceptedSources: Set<string>): string {
  const raw = text(value, 2_000);
  const canonical = raw ? canonicalSource(raw) : "";
  return canonical && acceptedSources.has(canonical) ? raw : "";
}

function researchEvidenceStatus(value: unknown): ResearchEvidenceStatus {
  const status = text(value, 40);
  return RESEARCH_EVIDENCE_STATUSES.has(status) ? status as ResearchEvidenceStatus : "gap";
}

function clamped(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

export function collectOpenAIWebSources(value: unknown): Set<string> {
  const sources = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const item = record(node);
    if (!item) return;
    const sourceUrl = text(item.url, 2_000);
    const canonical = sourceUrl ? canonicalSource(sourceUrl) : "";
    if (canonical && (
      item.type === "url_citation" ||
      item.type === "url" ||
      item.type === "web_search_result" ||
      "title" in item
    )) sources.add(canonical);
    Object.values(item).forEach(visit);
  };
  visit(value);
  return sources;
}

/**
 * A proposed flow is a question to confirm, not a claim of fact: an unverifiable URL
 * downgrades the step to `gap` instead of dropping it. Ids and order are derived from
 * position so re-parsing the same payload yields the same identifiers.
 */
export function parseValueFlow(value: unknown, acceptedSources: Set<string>): ValueFlowStep[] {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => {
      const step = record(item);
      if (!step) return null;
      const order = Number(step.order);
      return { step, index, order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER };
    })
    .filter((entry): entry is { step: Record<string, unknown>; index: number; order: number } =>
      Boolean(entry))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ step }) => {
      const name = text(step.name, 120);
      const description = text(step.description, 500);
      const input = text(step.input, 240);
      const output = text(step.output, 240);
      const actor = text(step.actor, 160);
      const system = text(step.system, 160);
      const confirmationQuestion = text(step.confirmation_question, 400);
      if (!name || !description || !input || !output || !actor || !system || !confirmationQuestion) {
        return null;
      }
      const sourceUrl = allowedSourceUrl(step.source_url, acceptedSources);
      return {
        name,
        description,
        input,
        output,
        actor,
        system,
        evidenceStatus: sourceUrl ? researchEvidenceStatus(step.evidence_status) : "gap",
        sourceUrls: sourceUrl ? [sourceUrl] : [],
        confidence: clamped(step.confidence, 0.4),
        confirmationQuestion,
      };
    })
    .filter((step): step is Omit<ValueFlowStep, "id" | "order"> => Boolean(step))
    .slice(0, MAX_FLOW_STEPS)
    .map((step, index) => ({ ...step, id: `flow_${index + 1}`, order: index + 1 }));
}

export function parseDiscoveryQuestions(
  value: unknown,
  acceptedSources: Set<string>,
): DiscoveryQuestion[] {
  const counters = new Map<DiscoverySection, number>();
  return (Array.isArray(value) ? value : [])
    .map((item): Omit<DiscoveryQuestion, "id"> | null => {
      const entry = record(item);
      if (!entry) return null;
      const section = text(entry.section, 30);
      const question = text(entry.question, 500);
      const whyItMatters = text(entry.why_it_matters, 400);
      const publicAssumption = text(entry.public_assumption, 400);
      if (!SECTIONS.has(section) || !question || !whyItMatters || !publicAssumption) return null;
      const sourceUrl = allowedSourceUrl(entry.source_url, acceptedSources);
      const answerType = text(entry.expected_answer_type, 30);
      const canvasBlock = canonicalCanvasBlock(entry.canvas_block);
      const followUps = (Array.isArray(entry.follow_ups) ? entry.follow_ups : [])
        .map((followUp) => text(followUp, 300))
        .filter(Boolean)
        .slice(0, 5);
      return {
        section: section as DiscoverySection,
        question,
        whyItMatters,
        publicAssumption,
        sourceUrls: sourceUrl ? [sourceUrl] : [],
        evidenceStatus: sourceUrl ? researchEvidenceStatus(entry.evidence_status) : "gap",
        ...(canvasBlock ? { canvasBlock } : {}),
        expectedAnswerType: ANSWER_TYPES.has(answerType)
          ? answerType as DiscoveryQuestion["expectedAnswerType"]
          : "narrative",
        required: entry.required === true,
        followUps,
      };
    })
    .filter((entry): entry is Omit<DiscoveryQuestion, "id"> => Boolean(entry))
    .slice(0, MAX_DISCOVERY_QUESTIONS)
    .map((entry) => {
      const next = (counters.get(entry.section) ?? 0) + 1;
      counters.set(entry.section, next);
      return { ...entry, id: `q_${entry.section}_${next}` };
    });
}

export function parseOpenAIResearchPayload(
  value: unknown,
  primarySourceUrl: string,
  allowedSources: Set<string>,
): ParsedOpenAIResearch {
  const payload = record(value);
  if (!payload) throw new Error("OpenAI research response was not an object.");
  const primarySource = canonicalSource(primarySourceUrl);
  const acceptedSources = new Set(allowedSources);
  if (primarySource) acceptedSources.add(primarySource);

  const facts = (Array.isArray(payload.facts) ? payload.facts : [])
    .slice(0, 18)
    .map((item): EvidenceClaim | null => {
      const fact = record(item);
      if (!fact) return null;
      const statement = text(fact.statement, 600);
      const sourceUrl = text(fact.source_url, 2_000);
      const source = canonicalSource(sourceUrl);
      const canvasBlock = text(fact.canvas_block, 80);
      const confidence = Number(fact.confidence);
      if (
        !statement ||
        !source ||
        !acceptedSources.has(source) ||
        !CANVAS_BLOCKS.has(canvasBlock)
      ) return null;
      return {
        statement,
        provenance: "public-research",
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
        sourceLabel: text(fact.source_label, 120) || new URL(sourceUrl).hostname,
        sourceUrl,
        canvasBlock,
      };
    })
    .filter((fact): fact is EvidenceClaim => Boolean(fact));

  const gaps = (Array.isArray(payload.gaps) ? payload.gaps : [])
    .map((item) => text(item, 180))
    .filter(Boolean)
    .slice(0, 12);

  const constraintHypotheses = (Array.isArray(payload.constraint_hypotheses)
    ? payload.constraint_hypotheses
    : [])
    .slice(0, 8)
    .map((item): ConstraintHypothesis | null => {
      const hypothesis = record(item);
      if (!hypothesis) return null;
      const canvasBlock = text(hypothesis.canvas_block, 80);
      const type = text(hypothesis.type, 30) as ConstraintType;
      const evidenceHint = text(hypothesis.evidence_hint, 360);
      const confirmationCondition = text(hypothesis.confirmation_condition, 360);
      const killCondition = text(hypothesis.kill_condition, 360);
      if (
        !CANVAS_BLOCKS.has(canvasBlock) ||
        !CONSTRAINT_TYPES.has(type) ||
        !evidenceHint ||
        !confirmationCondition ||
        !killCondition
      ) return null;
      return { canvasBlock, type, evidenceHint, confirmationCondition, killCondition };
    })
    .filter((item): item is ConstraintHypothesis => Boolean(item));

  return {
    summary: text(payload.summary, 1_000),
    facts,
    gaps,
    constraintHypotheses,
    valueFlow: parseValueFlow(payload.value_flow, acceptedSources),
    discoveryQuestions: parseDiscoveryQuestions(payload.discovery_questions, acceptedSources),
  };
}
