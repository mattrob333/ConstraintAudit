import type { Credentials } from "./secrets";
import type { BaselineMetric, ConstraintType, DirectionInference } from "./workflow";

/**
 * Which way a metric has to move to count as an improvement.
 *
 * Four tiers, in order: the advisor's own declaration, the unit, the metric name, then a
 * cheap one-shot model question. Every tier is a default the advisor can overrule, and no
 * tier is ever allowed to guess: where two readings disagree and nothing can settle them,
 * this returns `improvedWhen: null` with `ambiguous: true` so the UI can ask a specific
 * question. An earlier version guessed "up is good" and wrote "worsened" into a client
 * report about a turnaround time that had halved.
 */

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-sol";

type Direction = "higher" | "lower";

export interface MetricDirectionContext {
  constraintType?: ConstraintType;
  advisorDeclared?: Direction;
}

type Signal = {
  better: Direction;
  weight: number;
  words: string[];
  /** Base-form verb phrase completing `"<metric>" counts …` or `Days measure …`. */
  reads: string;
  /** Overrides the default ", so a higher/lower number is better" ending. */
  tail?: string;
  /** A count noun only reads as throughput when it heads the metric name. */
  headOnly?: boolean;
  /** A unit count only reads as throughput when a period says what it is counted over. */
  needsPeriod?: boolean;
  /** Marks elapsed-time readings, which suppress the throughput reading of a count noun. */
  duration?: boolean;
};

/**
 * The unit's own dimension, read before the metric name. Order matters: problem nouns are
 * checked before throughput counts, and currency (`$`, `£`, `€`) and `%` are deliberately
 * absent — both carry no direction until the name says cost or revenue, rework or on-time.
 */
const UNIT_SIGNALS: Signal[] = [
  {
    better: "lower",
    weight: 3,
    duration: true,
    words: [
      "second", "sec", "minute", "min", "hour", "hr", "day", "week", "month",
      "business day", "working day", "calendar day", "business hour", "man hour",
    ],
    reads: "measure elapsed time",
    tail: ", so a lower number is faster",
  },
  {
    better: "lower",
    weight: 3,
    words: [
      "wait", "waiting", "delay", "queue", "backlog", "cycle time", "turnaround",
      "rework", "defect", "error", "fault", "complaint", "escalation", "incident",
      "churn", "cost",
    ],
    reads: "count things that went wrong",
  },
  {
    better: "higher",
    weight: 2,
    needsPeriod: true,
    words: [
      "order", "bid", "lead", "job", "invoice", "customer", "unit", "ticket", "deal",
      "quote", "estimate", "install", "project", "enquiry", "inquiry", "booking",
      "delivery", "shipment", "sale", "application", "referral",
    ],
    reads: "count work completed over a period",
    tail: ", so a higher number means more throughput",
  },
  {
    better: "higher",
    weight: 2,
    words: [
      "capacity", "revenue", "margin", "uptime", "availability", "satisfaction",
      "conversion", "throughput", "nps",
    ],
    reads: "measure what the business captures",
  },
];

/**
 * The metric name, which is where the traps are: `%` is rework rate or on-time delivery,
 * currency is cost per job or revenue per job, and a per-period count is throughput unless
 * the noun is a defect. Matched against the numerator only — the denominator of
 * "cost per job" names what the metric is divided by, never which way is better.
 */
const NAME_SIGNALS: Signal[] = [
  {
    better: "lower",
    weight: 3,
    words: [
      "turnaround", "cycle time", "lead time", "wait time", "waiting time", "response time",
      "resolution time", "idle time", "hold time", "dwell time", "time to", "wait", "waiting",
      "delay", "downtime",
    ],
    reads: "measure time work spends waiting or in progress",
  },
  {
    better: "lower",
    weight: 3,
    words: ["queue", "backlog", "work in progress", "wip", "unallocated", "aging", "ageing"],
    reads: "count work stacked up waiting",
  },
  {
    better: "lower",
    weight: 3,
    words: [
      "rework", "defect", "error", "mistake", "fault", "failure", "bug", "snag", "scrap",
      "waste", "callback", "call back", "warranty claim", "reject", "rejection", "incident",
      "punch list",
    ],
    reads: "count work that had to be fixed or redone",
  },
  {
    better: "lower",
    weight: 3,
    words: [
      "complaint", "escalation", "churn", "cancellation", "no show", "dispute", "refund",
      "chargeback", "attrition", "abandonment",
    ],
    reads: "count customers who were let down or lost",
  },
  {
    better: "lower",
    weight: 3,
    words: [
      "overdue", "late", "missed", "overrun", "slippage", "backorder", "stockout",
      "absenteeism", "overtime",
    ],
    reads: "count commitments that slipped",
  },
  {
    better: "lower",
    weight: 3,
    words: ["cost", "spend", "expense", "overhead", "burn", "write off"],
    reads: "measure money going out",
  },
  {
    better: "lower",
    weight: 2,
    duration: true,
    words: ["second", "minute", "hour", "day", "week", "month", "time", "duration"],
    reads: "measure elapsed time",
    tail: ", so a lower number is faster",
  },
  {
    better: "higher",
    weight: 3,
    words: ["revenue", "sale", "income", "profit", "margin", "turnover", "mrr", "arr"],
    reads: "measure money coming in",
  },
  {
    better: "higher",
    weight: 3,
    words: [
      "on time", "in full", "first time fix", "first time right", "right first time",
      "satisfaction", "nps", "csat", "retention", "uptime", "availability", "accuracy",
    ],
    reads: "measure how often the promise was kept",
  },
  {
    better: "higher",
    weight: 3,
    words: [
      "capacity", "throughput", "output", "yield", "productivity", "efficiency",
      "utilisation", "utilization", "conversion", "win rate", "close rate", "hit rate",
    ],
    reads: "measure how much the business can get done or win",
  },
  {
    better: "higher",
    weight: 2,
    headOnly: true,
    words: [
      "order", "bid", "lead", "job", "invoice", "customer", "client", "unit", "ticket",
      "deal", "quote", "estimate", "install", "installation", "project", "enquiry",
      "inquiry", "referral", "signup", "subscriber", "account", "appointment", "booking",
      "delivery", "shipment", "application", "proposal",
    ],
    reads: "count work or customers coming through",
    tail: ", so a higher number means more throughput",
  },
];

function singular(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss")
    ? token.slice(0, -1)
    : token;
}

/** Space-padded, singularised text so table entries can be matched as whole phrases. */
function normalize(value: string): string {
  const tokens = value
    .toLowerCase()
    .replace(/\//g, " per ")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(singular);
  return tokens.length ? ` ${tokens.join(" ")} ` : "";
}

function numeratorOf(name: string): string {
  const text = normalize(name);
  const cut = text.indexOf(" per ");
  return cut === -1 ? text : `${text.slice(0, cut)} `;
}

function clause(signal: Signal, conjugate: boolean, withTail = true): string {
  const [verb, ...rest] = signal.reads.split(" ");
  const phrase = [conjugate ? `${verb}s` : verb, ...rest].join(" ");
  return withTail
    ? `${phrase}${signal.tail ?? `, so a ${signal.better} number is better`}`
    : phrase;
}

function sentenceCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

/** "days per estimate" — the period often already reads as a phrase, so don't double the "per". */
function measureLabel(unit: string, period: string): string {
  const trimmedUnit = unit.trim();
  const trimmedPeriod = period.trim();
  if (!trimmedPeriod) return trimmedUnit;
  return /^(per|each|every|a|an)\b/i.test(trimmedPeriod)
    ? `${trimmedUnit} ${trimmedPeriod}`
    : `${trimmedUnit} per ${trimmedPeriod}`;
}

type Reading = { direction: Direction; weight: number; basis: string; signal: Signal };

function readUnit(unit: string, period: string): Reading | null {
  const text = normalize(unit);
  if (!text) return null;
  const hasPeriod = normalize(period).length > 0;
  for (const signal of UNIT_SIGNALS) {
    if (signal.needsPeriod && !hasPeriod) continue;
    if (!signal.words.some((word) => text.includes(` ${word} `))) continue;
    // Verb agreement follows the unit alone ("days measure"), not the whole label.
    const plural = /s$/i.test(unit.trim());
    const label = sentenceCase(measureLabel(unit, period));
    return {
      direction: signal.better,
      weight: signal.weight,
      basis: `${label} ${clause(signal, !plural)}.`,
      signal,
    };
  }
  return null;
}

type NameReading = {
  direction: Direction | null;
  score: number;
  rival: number;
  tied: boolean;
  basis: string;
  top: Partial<Record<Direction, Signal>>;
};

function readName(name: string): NameReading {
  const text = numeratorOf(name);
  const empty: NameReading = { direction: null, score: 0, rival: 0, tied: false, basis: "", top: {} };
  if (!text) return empty;

  const totals: Record<Direction, number> = { higher: 0, lower: 0 };
  const best: Partial<Record<Direction, { signal: Signal; weight: number }>> = {};
  let remaining = text;
  let durationMatched = false;

  const score = (signals: Signal[]): void => {
    const candidates = signals
      .flatMap((signal) => signal.words.map((word) => ({ signal, word })))
      .sort((a, b) => b.word.length - a.word.length);
    for (const { signal, word } of candidates) {
      const needle = ` ${word} `;
      if (!remaining.includes(needle)) continue;
      if (signal.headOnly && !text.endsWith(needle)) continue;
      // Consume the match so "on-time delivery" never also scores as elapsed "time".
      remaining = remaining.split(needle).join(" ");
      // English compounds are head-final: the last word is what the metric is really of.
      const weight = signal.weight + (text.endsWith(needle) ? 1 : 0);
      totals[signal.better] += weight;
      if (signal.duration) durationMatched = true;
      const current = best[signal.better];
      if (!current || weight > current.weight) best[signal.better] = { signal, weight };
    }
  };

  score(NAME_SIGNALS.filter((signal) => !signal.headOnly));
  // "days to quote" heads on a count noun but measures a duration; it is not throughput.
  if (!durationMatched) score(NAME_SIGNALS.filter((signal) => signal.headOnly));

  const top: Partial<Record<Direction, Signal>> = {
    ...(best.lower ? { lower: best.lower.signal } : {}),
    ...(best.higher ? { higher: best.higher.signal } : {}),
  };
  if (!totals.higher && !totals.lower) return empty;
  if (totals.higher === totals.lower) {
    return { direction: null, score: totals.higher, rival: totals.lower, tied: true, basis: "", top };
  }
  const direction: Direction = totals.higher > totals.lower ? "higher" : "lower";
  const signal = best[direction]?.signal;
  return {
    direction,
    score: totals[direction],
    rival: totals[direction === "higher" ? "lower" : "higher"],
    tied: false,
    basis: signal ? `"${sentenceCase(name.trim())}" ${clause(signal, true)}.` : "",
    top,
  };
}

function bothWaysBasis(name: string, lower: string, higher: string): string {
  const subject = name.trim() ? `"${sentenceCase(name.trim())}"` : "This metric";
  return `${subject} reads two ways — it could ${lower} (lower is better) or ${higher} (higher is better). The advisor has to say which one this metric is.`;
}

function undecided(name: string, unit: string): DirectionInference {
  const label = name.trim() || unit.trim();
  return {
    improvedWhen: null,
    source: "none",
    basis: label
      ? `Nothing in "${label}" or its unit says which way is better, so the advisor has to declare whether a higher or a lower number counts as the improvement.`
      : "This metric has no name or unit to read, so the advisor has to declare which way counts as the improvement.",
    confidence: 0,
  };
}

type Analysis = { inference: DirectionInference; consultModel: boolean };

/** Tiers 1-3. `consultModel` is set only where the deterministic tiers are silent or fight. */
function analyze(metric: BaselineMetric | undefined, context?: MetricDirectionContext): Analysis {
  const name = typeof metric?.name === "string" ? metric.name : "";
  const unit = typeof metric?.unit === "string" ? metric.unit : "";
  const period = typeof metric?.period === "string" ? metric.period : "";

  const declared = context?.advisorDeclared;
  if (declared === "higher" || declared === "lower") {
    return {
      inference: {
        improvedWhen: declared,
        source: "advisor",
        basis: `The advisor set this metric to count as improved when the number goes ${declared}.`,
        confidence: 1,
      },
      consultModel: false,
    };
  }

  const fromUnit = readUnit(unit, period);
  const fromName = readName(name);

  if (fromName.tied) {
    const lower = fromName.top.lower;
    const higher = fromName.top.higher;
    return {
      inference: {
        improvedWhen: null,
        source: "none",
        basis: lower && higher
          ? bothWaysBasis(name, clause(lower, false, false), clause(higher, false, false))
          : undecided(name, unit).basis,
        confidence: 0,
        ambiguous: true,
      },
      consultModel: true,
    };
  }

  if (!fromUnit && !fromName.direction) {
    return { inference: undecided(name, unit), consultModel: true };
  }

  if (fromUnit && !fromName.direction) {
    return {
      inference: {
        improvedWhen: fromUnit.direction,
        source: "unit-table",
        basis: fromUnit.basis,
        confidence: 0.75,
      },
      consultModel: false,
    };
  }

  if (!fromUnit && fromName.direction) {
    return {
      inference: {
        improvedWhen: fromName.direction,
        source: "metric-semantics",
        basis: fromName.basis,
        confidence: fromName.score - fromName.rival >= 3 ? 0.8 : 0.65,
      },
      consultModel: false,
    };
  }

  if (fromUnit && fromName.direction === fromUnit.direction) {
    const nameWins = fromName.score >= fromUnit.weight;
    return {
      inference: {
        improvedWhen: fromUnit.direction,
        source: nameWins ? "metric-semantics" : "unit-table",
        basis: nameWins ? fromName.basis : fromUnit.basis,
        confidence: 0.9,
      },
      consultModel: false,
    };
  }

  // Unit and name disagree. A confident name beats the unit, but the model still gets asked.
  if (fromUnit && fromName.direction && fromName.score >= 3 && fromName.score > fromUnit.weight) {
    return {
      inference: {
        improvedWhen: fromName.direction,
        source: "metric-semantics",
        basis: `${fromName.basis.replace(/\.$/, "")} — the unit on its own would have read the other way.`,
        confidence: 0.6,
      },
      consultModel: true,
    };
  }

  const lowerClause = fromUnit?.direction === "lower"
    ? clause(fromUnit.signal, false, false)
    : fromName.top.lower
      ? clause(fromName.top.lower, false, false)
      : "count something the business wants less of";
  const higherClause = fromUnit?.direction === "higher"
    ? clause(fromUnit.signal, false, false)
    : fromName.top.higher
      ? clause(fromName.top.higher, false, false)
      : "count something the business wants more of";
  return {
    inference: {
      improvedWhen: null,
      source: "none",
      basis: bothWaysBasis(name, lowerClause, higherClause),
      confidence: 0,
      ambiguous: true,
    },
    consultModel: true,
  };
}

/**
 * Tiers 1-3: pure, synchronous, deterministic, and total. Garbage in returns
 * `improvedWhen: null` with `source: "none"`, never a throw and never a guess.
 *
 * `context.constraintType` deliberately does not decide a direction here; it is passed to
 * the model as context only. A constraint type is too coarse to settle a specific metric.
 */
export function inferMetricDirection(
  metric: BaselineMetric,
  context?: MetricDirectionContext,
): DirectionInference {
  try {
    return analyze(metric, context).inference;
  } catch {
    return undecided("", "");
  }
}

type OpenAIResponse = {
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

/**
 * Imported lazily so the pure tiers stay importable outside the Worker runtime. With
 * credentials the resolver owns precedence (server secret wins) and no binding is touched.
 */
async function configuredValue(name: string, credentials?: Credentials): Promise<string> {
  if (credentials) return credentials.get(name).trim();
  const { env } = await import("cloudflare:workers");
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

function outputText(response: OpenAIResponse): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .trim();
}

const directionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["improved_when", "reason"],
  properties: {
    improved_when: { type: "string", enum: ["higher", "lower", "unclear"] },
    reason: { type: "string" },
  },
} as const;

function oneSentence(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const clipped = text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text;
  return /[.!?…]$/.test(clipped) ? sentenceCase(clipped) : `${sentenceCase(clipped)}.`;
}

async function askModel(
  metric: BaselineMetric | undefined,
  context: MetricDirectionContext | undefined,
  fetcher: typeof fetch,
  credentials?: Credentials,
): Promise<DirectionInference | null> {
  try {
    const key = await configuredValue("OPENAI_API_KEY", credentials);
    if (!key) return null;
    const model = (await configuredValue("OPENAI_RESEARCH_MODEL", credentials)) || DEFAULT_MODEL;
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
        max_output_tokens: 1_500,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "tier4_metric_direction",
            strict: true,
            schema: directionSchema,
          },
        },
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text: [
                  "A business advisor is measuring one operating metric before and after a change.",
                  "Say whether a higher or a lower number means the business improved.",
                  "Answer unclear whenever the metric could honestly read either way; a wrong call would put the word \"worsened\" in a client report.",
                  "reason: one short plain sentence a person would write, naming what the metric measures. No rule names, no jargon, no restating the question.",
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
                  metric: metric?.name ?? "",
                  unit: metric?.unit ?? "",
                  period: metric?.period ?? "",
                  constraintType: context?.constraintType ?? "",
                }),
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json() as OpenAIResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `OpenAI returned HTTP ${response.status}.`);
    }
    const raw = outputText(body);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { improved_when?: unknown; reason?: unknown };
    const direction = parsed.improved_when === "higher" || parsed.improved_when === "lower"
      ? parsed.improved_when
      : null;
    if (!direction) return null;
    const reason = oneSentence(typeof parsed.reason === "string" ? parsed.reason : "");
    const label = (metric?.name ?? "").trim();
    return {
      improvedWhen: direction,
      source: "model",
      basis: reason || `A ${direction} number on ${label || "this metric"} was read as the improvement; confirm it before it reaches a client.`,
      confidence: 0.6,
    };
  } catch {
    return null;
  }
}

/**
 * Tiers 1-4. The model is asked only where the unit and the name are silent or contradict
 * each other, and any failure — no key, timeout, bad JSON, "unclear" — degrades to whatever
 * tiers 2-3 concluded rather than throwing or blocking the advisor.
 */
export async function resolveMetricDirection(
  metric: BaselineMetric,
  context?: MetricDirectionContext,
  fetcher: typeof fetch = fetch,
  credentials?: Credentials,
): Promise<DirectionInference> {
  let local: Analysis;
  try {
    local = analyze(metric, context);
  } catch {
    local = { inference: undecided("", ""), consultModel: false };
  }
  if (!local.consultModel) return local.inference;
  const settled = await askModel(metric, context, fetcher, credentials);
  return settled ?? local.inference;
}
