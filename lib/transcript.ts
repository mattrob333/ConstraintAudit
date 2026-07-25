import {
  makeId,
  type BaselineStatus,
  type ConstraintFinding,
  type ConstraintType,
  type ExtractedMetric,
  type TranscriptLine,
  type TranscriptSynthesis,
} from "./workflow";

const CONSTRAINT_SIGNALS: Array<{ type: ConstraintType; words: string[]; block: string; prescription: string }> = [
  {
    type: "capacity",
    words: ["backlog", "piling up", "too much", "can't keep up", "turn away", "capacity"],
    block: "Key Resources",
    prescription: "Remove the highest-volume repeatable task from the accountable person's queue while preserving their approval.",
  },
  {
    type: "latency",
    words: ["wait", "delay", "slow", "turnaround", "days", "weeks", "bottleneck"],
    block: "Key Activities",
    prescription: "Shorten the constrained handoff with one visible queue, owner, and service-time target.",
  },
  {
    type: "quality",
    words: ["rework", "error", "mistake", "defect", "redo"],
    block: "Value Propositions",
    prescription: "Add the smallest validation step before the rework-producing handoff.",
  },
  {
    type: "knowledge",
    words: ["only one", "only i", "expert", "in my head", "nobody else"],
    block: "Key Resources",
    prescription: "Externalize the critical decision pattern into a reviewable playbook owned by the current expert.",
  },
  {
    type: "policy",
    words: ["approval", "sign off", "policy", "permission", "authorized"],
    block: "Key Activities",
    prescription: "Narrow the approval rule to the decisions that truly require accountable human judgment.",
  },
];

const METRIC_PATTERN =
  /\b(?:about|roughly|around|approximately)?\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*(%|percent|hours?|days?|weeks?|months?|orders?|bids?|leads?|invoices?|jobs?|requests?|customers?)\b(?:\s*(?:per|each|every)\s*(day|week|month|quarter|year|order|bid|lead|invoice|job|request|customer))?/i;

function timeLabel(value: number): string {
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function speakerProvenance(
  speaker: string,
  roles: Record<string, "client" | "advisor" | "unknown">,
): TranscriptLine["provenance"] {
  const explicit = roles[speaker] ?? roles[speaker.toLowerCase()];
  if (explicit === "client") return "client-stated";
  if (explicit === "advisor") return "advisor-note";
  if (explicit === "unknown") return "gap";
  if (/^(advisor|consultant|tier\s*4|facilitator)\b/i.test(speaker)) return "advisor-note";
  if (/^unknown\b/i.test(speaker)) return "gap";
  return "client-stated";
}

export function parseTranscriptText(
  text: string,
  speakerRoles: Record<string, "client" | "advisor" | "unknown"> = {},
): TranscriptLine[] {
  const rawLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed: TranscriptLine[] = [];
  let syntheticSeconds = 0;
  for (const raw of rawLines) {
    const matched = raw.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:-\s*)?([^:]{1,80}):\s*(.+)$/);
    if (matched) {
      parsed.push({
        timestamp: matched[1],
        speaker: matched[2].trim(),
        text: matched[3].trim(),
        speakerConfidence: "unknown",
        provenance: speakerProvenance(matched[2].trim(), speakerRoles),
      });
    } else {
      parsed.push({
        timestamp: timeLabel(syntheticSeconds),
        speaker: "Unknown speaker",
        text: raw,
        speakerConfidence: "unknown",
        provenance: "gap",
      });
    }
    syntheticSeconds += 20;
  }
  return parsed;
}

export function extractMetrics(lines: TranscriptLine[]): ExtractedMetric[] {
  return lines.flatMap((line) => {
    if (line.provenance !== "client-stated") return [];
    const match = line.text.match(METRIC_PATTERN);
    if (!match) return [];
    const unit = match[2].toLowerCase();
    const period = (match[3] ?? "").toLowerCase();
    return [{
      label: `Client-stated ${unit.replace(/s$/, "")} metric`,
      value: `${match[1]} ${match[2]}`,
      quote: line.text,
      speaker: line.speaker,
      timestamp: line.timestamp,
      unit,
      period,
      provenance: "client-stated" as const,
    }];
  });
}

function candidateFor(lines: TranscriptLine[]): (typeof CONSTRAINT_SIGNALS)[number] | null {
  const corpus = lines
    .filter((line) => line.provenance === "client-stated")
    .map((line) => line.text.toLowerCase())
    .join(" ");
  const winner = CONSTRAINT_SIGNALS.map((signal) => ({
    signal,
    score: signal.words.reduce((sum, word) => sum + (corpus.includes(word) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score)[0];
  return winner.score > 0 ? winner.signal : null;
}

export function baselineStatusFor(metrics: ExtractedMetric[]): BaselineStatus {
  if (metrics.length === 0) return "Missing";
  return metrics.some(
    (metric) =>
      metric.label.trim() &&
      metric.value.trim() &&
      metric.unit.trim() &&
      metric.period.trim() &&
      metric.quote.trim() &&
      metric.speaker.trim() &&
      metric.timestamp.trim() &&
      metric.provenance === "client-stated",
  ) ? "Confirmed" : "Partial";
}

export function synthesizeTranscript(
  text: string,
  options: {
    client: string;
    callNumber: 1 | 2;
    transcriptUrl?: string;
    humanOwner?: { name: string; role: string };
    speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
  },
): TranscriptSynthesis {
  const lines = parseTranscriptText(text, options.speakerRoles);
  const metrics = extractMetrics(lines);
  const baselineStatus = baselineStatusFor(metrics);
  const candidate = candidateFor(lines);
  if (!candidate) {
    return {
      callNumber: options.callNumber,
      lineCount: lines.length,
      quotes: [],
      metrics,
      baselineStatus,
      gaps: [
        "No client-stated constraint signal was found.",
        "Confirm one baseline metric with value, unit, period, source, and accountable owner.",
      ],
      constraintCandidate: null,
    };
  }
  const scoredQuotes = lines
    .filter((line) => line.provenance === "client-stated")
    .map((line) => ({
      ...line,
      score: candidate.words.reduce((sum, word) => sum + (line.text.toLowerCase().includes(word) ? 1 : 0), 0),
    }))
    .filter((line) => line.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const evidence = scoredQuotes.map((line) => ({
    quote: line.text,
    speaker: line.speaker,
    timestamp: line.timestamp,
    transcriptUrl: options.transcriptUrl ?? "",
    provenance: "client-stated" as const,
  }));
  const owner = options.humanOwner ?? { name: "", role: "" };
  const isConfirmed = baselineStatus === "Confirmed" && options.callNumber === 2;
  const metric = metrics.find((item) => item.period) ?? metrics[0];
  const baselineMetric = {
    name: metric?.label ?? "",
    value: baselineStatus === "Confirmed" ? metric?.value ?? "" : "",
    unit: baselineStatus === "Confirmed" ? metric?.unit ?? "" : "",
    period: baselineStatus === "Confirmed" ? metric?.period ?? "" : "",
    source: metric ? `${metric.speaker} at ${metric.timestamp}: ${metric.quote}` : "Missing",
  };
  const finding: ConstraintFinding = {
    constraintId: makeId("con"),
    client: options.client,
    canvasBlock: candidate.block,
    constraintType: candidate.type,
    findingStatus: isConfirmed ? "client-verified" : "provisional",
    symptoms: evidence.map((item) => ({ statement: item.quote, number: item.quote.match(METRIC_PATTERN)?.[0] ?? "" })),
    evidence,
    baselineMetric,
    prescription: {
      description: candidate.prescription,
      whySmallestIntervention: "It acts only on the currently evidenced constraint and keeps a named human accountable.",
    },
    projectedDelta: {
      formula: "ending metric - starting metric",
      namedInputs: ["confirmed starting metric", "measured ending metric", "measurement period"],
      low: "",
      base: "",
      high: "",
      confidence: baselineStatus === "Confirmed" ? "Awaiting measured result" : "Blocked by missing baseline",
    },
    baselineInstrumentation: {
      required: baselineStatus !== "Confirmed",
      firstSprintTask:
        baselineStatus === "Confirmed"
          ? ""
          : "Name the metric owner and capture the starting metric in the live workflow before intervention.",
      measurementClockStartsWhen: "The named owner records and confirms the starting metric.",
    },
    humanOwner: owner,
    predictedNextConstraint: "Reassess after the intervention; do not infer the next constraint before measurement.",
    killCondition: `Client evidence or measurements show ${candidate.type} is not limiting throughput.`,
    appendixItems: [],
  };

  return {
    callNumber: options.callNumber,
    lineCount: lines.length,
    quotes: scoredQuotes.map((line) => ({
      speaker: line.speaker,
      timestamp: line.timestamp,
      text: line.text,
      speakerConfidence: line.speakerConfidence,
      reason: `Contains ${candidate.type} constraint language.`,
      provenance: "client-stated" as const,
    })),
    metrics,
    baselineStatus,
    gaps: baselineStatus === "Confirmed" ? [] : [
      "Confirm one baseline metric with value, unit, period, source, and accountable owner.",
    ],
    constraintCandidate: finding,
  };
}
