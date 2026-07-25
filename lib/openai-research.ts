import { env } from "cloudflare:workers";
import {
  collectOpenAIWebSources,
  parseOpenAIResearchPayload,
} from "./openai-research-schema";
import type { ResearchSynthesis } from "./workflow";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-sol";

type OpenAIResponse = {
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function bindings(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

function configuredValue(name: string): string {
  const value = bindings()[name];
  return typeof value === "string" ? value.trim() : "";
}

export function openAIResearchConfigured(): boolean {
  return configuredValue("OPENAI_API_KEY").length > 0;
}

export function openAIResearchModel(): string {
  return configuredValue("OPENAI_RESEARCH_MODEL") || DEFAULT_MODEL;
}

function outputText(response: OpenAIResponse): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .trim();
}

const researchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "facts", "gaps", "constraint_hypotheses"],
  properties: {
    summary: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "canvas_block", "source_label", "source_url", "confidence"],
        properties: {
          statement: { type: "string" },
          canvas_block: {
            type: "string",
            enum: [
              "Key Partners", "Key Activities", "Key Resources", "Value Propositions",
              "Customer Relationships", "Channels", "Customer Segments",
              "Cost Structure", "Revenue Streams",
            ],
          },
          source_label: { type: "string" },
          source_url: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    gaps: { type: "array", items: { type: "string" } },
    constraint_hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "canvas_block", "type", "evidence_hint",
          "confirmation_condition", "kill_condition",
        ],
        properties: {
          canvas_block: {
            type: "string",
            enum: [
              "Key Partners", "Key Activities", "Key Resources", "Value Propositions",
              "Customer Relationships", "Channels", "Customer Segments",
              "Cost Structure", "Revenue Streams",
            ],
          },
          type: {
            type: "string",
            enum: ["capacity", "latency", "quality", "knowledge", "policy"],
          },
          evidence_hint: { type: "string" },
          confirmation_condition: { type: "string" },
          kill_condition: { type: "string" },
        },
      },
    },
  },
} as const;

export async function enrichResearchWithOpenAI(
  base: ResearchSynthesis,
  client: string,
  fetcher: typeof fetch = fetch,
): Promise<ResearchSynthesis> {
  const key = configuredValue("OPENAI_API_KEY");
  const model = openAIResearchModel();
  if (!key) {
    return {
      ...base,
      researchMode: "deterministic",
      providerStatus: "not-configured",
    };
  }

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
        reasoning: { effort: "low" },
        max_output_tokens: 5_000,
        tools: [{ type: "web_search" }],
        include: ["web_search_call.action.sources"],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "tier4_public_research",
            strict: true,
            schema: researchSchema,
          },
        },
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text: [
                  "Research a company for a live advisor-led throughput audit.",
                  "Use public web sources only and use the supplied company website as the identity anchor.",
                  "Every fact must be directly supported by a web-search source URL returned in this response.",
                  "Do not infer private operations, internal metrics, bottlenecks, revenue, costs, headcount, or workflow.",
                  "Put unknown operating facts in gaps. Constraint hypotheses are questions to test, never findings.",
                  "Keep claims concise and assign each supported fact to exactly one Business Model Canvas block.",
                ].join(" "),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  client,
                  companyWebsite: base.sourceUrl,
                  websiteSummary: base.description,
                  websiteFacts: base.facts.map((fact) => fact.statement),
                  requiredBaselines: base.gaps,
                }),
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json() as OpenAIResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `OpenAI returned HTTP ${response.status}.`);
    }
    const rawText = outputText(body);
    if (!rawText) throw new Error("OpenAI returned no research text.");
    const allowedSources = collectOpenAIWebSources(body);
    const parsed = parseOpenAIResearchPayload(
      JSON.parse(rawText) as unknown,
      base.sourceUrl,
      allowedSources,
    );
    const seenFacts = new Set<string>();
    const facts = [...parsed.facts, ...base.facts].filter((fact) => {
      const key = `${fact.statement.toLowerCase()}|${fact.sourceUrl ?? ""}`;
      if (seenFacts.has(key)) return false;
      seenFacts.add(key);
      return true;
    });
    const gaps = [...new Set([...parsed.gaps, ...base.gaps])];
    const seenHypotheses = new Set<string>();
    const constraintHypotheses = [
      ...parsed.constraintHypotheses,
      ...base.constraintHypotheses,
    ].filter((item) => {
      const key = `${item.canvasBlock}|${item.type}`;
      if (seenHypotheses.has(key)) return false;
      seenHypotheses.add(key);
      return true;
    }).slice(0, 8);
    return {
      ...base,
      description: parsed.summary || base.description,
      facts,
      gaps,
      constraintHypotheses,
      researchMode: "openai-web-search",
      providerStatus: "used",
      providerModel: model,
      sourceCount: new Set(facts.map((fact) => fact.sourceUrl).filter(Boolean)).size,
    };
  } catch {
    return {
      ...base,
      researchMode: "deterministic",
      providerStatus: "failed",
      providerModel: model,
    };
  }
}
