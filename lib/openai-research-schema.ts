import type {
  ConstraintHypothesis,
  ConstraintType,
  EvidenceClaim,
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

type ParsedOpenAIResearch = {
  summary: string;
  facts: EvidenceClaim[];
  gaps: string[];
  constraintHypotheses: ConstraintHypothesis[];
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
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return "";
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return "";
  }
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
  };
}
