import {
  canonicalCanvasBlock,
  makeId,
  type BaselineStatus,
  type CanvasBlock,
  type CanvasUpdate,
  type ConstraintFinding,
  type ConstraintType,
  type DiscoveryQuestion,
  type DiscoverySection,
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

const UNIT_WORDS =
  "hours?|hrs?|days?|weeks?|months?|quarters?|years?|minutes?|mins?|seconds?|orders?|bids?|quotes?|estimates?|proposals?|leads?|invoices?|jobs?|tickets?|requests?|customers?|clients?|projects?|calls?|emails?|units?|parts?|installs?|deliveries?|shipments?|people|employees?|techs?|technicians?|reps?|crews?|trucks?|sites?";
const PERIOD_WORDS =
  "day|week|month|quarter|year|hour|shift|order|bid|quote|estimate|proposal|lead|invoice|job|ticket|request|customer|client|project|install|delivery|shipment|site";
const APPROX = "(?:about|roughly|around|approximately|~|maybe)?\\s*";
const PERIOD_SUFFIX = `(?:\\s*(?:per|each|every|a|an)\\s+(${PERIOD_WORDS})s?\\b)?`;
const SPELLED_NUMBERS = "a couple of|a couple|a few|a handful of|a dozen|dozens of|several|one|two|three|four|five|six|seven|eight|nine|ten";

/**
 * Metric shapes we accept. Order matters: the widest shape wins the span so a range
 * is never re-read as a bare count. A metric still only ever comes from a
 * `client-stated` line, and every metric keeps its exact quote, speaker, timestamp.
 */
const METRIC_PATTERNS: Array<{
  pattern: RegExp;
  read: (match: RegExpExecArray) => { value: string; unit: string; period: string } | null;
}> = [
  {
    // 3 to 5 days, 3-5 days per order
    pattern: new RegExp(
      `\\b${APPROX}(\\d+(?:\\.\\d+)?)\\s*(?:-|–|—|to)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\b${PERIOD_SUFFIX}`,
      "gi",
    ),
    read: (match) => ({ value: `${match[1]}-${match[2]} ${match[3]}`, unit: match[3].toLowerCase(), period: (match[4] ?? "").toLowerCase() }),
  },
  {
    // $12,500 a month, £40k per job
    pattern: new RegExp(`([$£€])\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|m|b|thousand|million|billion)?\\b${PERIOD_SUFFIX}`, "gi"),
    read: (match) => ({
      value: `${match[1]}${match[2]}${match[3] ? match[3].toLowerCase() : ""}`,
      unit: currencyUnit(match[1]),
      period: (match[4] ?? "").toLowerCase(),
    }),
  },
  {
    // 30 percent, 12% per week
    pattern: new RegExp(`\\b${APPROX}(\\d+(?:\\.\\d+)?)\\s*(%|percent)\\b${PERIOD_SUFFIX}`, "gi"),
    read: (match) => ({ value: `${match[1]}%`, unit: "percent", period: (match[3] ?? "").toLowerCase() }),
  },
  {
    // 20 bids each week, about 3 days
    pattern: new RegExp(`\\b${APPROX}(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\b${PERIOD_SUFFIX}`, "gi"),
    read: (match) => ({ value: `${match[1]} ${match[2]}`, unit: match[2].toLowerCase(), period: (match[3] ?? "").toLowerCase() }),
  },
  {
    // 40 per week — a real rate, but the unit is unnamed, so it can never confirm a baseline.
    pattern: new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(?:per|each|every)\\s+(${PERIOD_WORDS})s?\\b`, "gi"),
    read: (match) => ({ value: match[1], unit: "", period: match[2].toLowerCase() }),
  },
  {
    // a couple of weeks — approximate wording, kept as evidence but never a confirmed baseline.
    pattern: new RegExp(`\\b(${SPELLED_NUMBERS})\\s+(${UNIT_WORDS})\\b${PERIOD_SUFFIX}`, "gi"),
    read: (match) => ({
      value: `${match[1].toLowerCase()} ${match[2].toLowerCase()}`,
      unit: match[2].toLowerCase(),
      period: (match[3] ?? "").toLowerCase(),
    }),
  },
];

const DECISION_PATTERN =
  /\b(we'll|we will|we're going to|we are going to|going to|let's|lets|we decided|we've decided|i'll|i will|next step|next steps|the plan is|we agreed)\b/i;
const TASK_PATTERN =
  /\b(action item|i'll|i will|we'll|we will|can you|could you|please|needs? to|has to|have to|follow up|send (?:me|you|over|us)|write up|set up|put together|get me|pull (?:the|a)|by (?:monday|tuesday|wednesday|thursday|friday|next week|end of (?:day|week|month)|tomorrow))\b/i;
const NEGATION_PATTERN =
  /\b(no|not|never|wrong|incorrect|actually|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|can't|won't|used to)\b/i;
const AFFIRMATION_PATTERN = /\b(yes|yeah|yep|correct|exactly|that's right|thats right|true|confirmed|absolutely|precisely)\b/i;
const SINGLE_POINT_PATTERN = /\b(only one|only i|only me|nobody else|no one else|in my head|just me|no backup)\b/i;
const APPROVAL_PATTERN = /\b(approve[sd]?|approval|sign off|signs off|signed off|signoff|final say)\b/i;
const ACCOUNTABLE_PATTERN = /\b(accountable|responsible|owns|owner|final say)\b/i;
const JUDGMENT_PATTERN = /\b(decide[sd]?|decision|judgment|judgement|review[sd]?|approve[sd]?|price[sd]?|scope[sd]?|negotiat\w*)\b/i;
const GRIND_PATTERN =
  /\b(manual\w*|by hand|copy|paste|re-?type|re-?enter|data entry|spreadsheet|repetitive|every single|chase|chasing|paperwork)\b/i;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "that", "this", "those", "these", "of", "to", "in", "on", "for",
  "with", "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being", "it", "its", "we", "our", "us",
  "you", "your", "i", "me", "my", "they", "them", "their", "he", "she", "his", "her", "do", "does", "did", "done",
  "have", "has", "had", "will", "would", "can", "could", "should", "just", "really", "like", "get", "got", "there",
  "here", "so", "not", "no", "yes", "about", "around", "which", "what", "when", "where", "who", "how", "all", "any",
  "some", "one", "also", "than", "because", "up", "down", "out", "over", "into", "more", "most", "very", "much",
  "many", "lot", "lots", "thing", "things", "stuff", "okay", "ok", "yeah", "um", "uh", "right", "well", "actually",
  "basically", "think", "know", "mean", "say", "said", "going", "go", "kind", "sort", "make", "made", "take", "takes",
]);

const SECTION_BLOCKS: Record<DiscoverySection, CanvasBlock> = {
  demand: "Customer Segments",
  promise: "Value Propositions",
  flow: "Key Activities",
  constraint: "Key Activities",
  baseline: "Key Activities",
  roles: "Key Resources",
  feasibility: "Key Resources",
};

function currencyUnit(symbol: string): string {
  if (symbol === "£") return "pounds";
  if (symbol === "€") return "euros";
  return "dollars";
}

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
    // Advisor notes and unmapped speakers are never a source of numbers.
    if (line.provenance !== "client-stated") return [];
    return metricsInText(line.text).map((metric) => ({
      label: metricLabel(metric.unit, metric.period),
      value: metric.value,
      quote: line.text,
      speaker: line.speaker,
      timestamp: line.timestamp,
      unit: metric.unit,
      period: metric.period,
      provenance: "client-stated" as const,
    }));
  });
}

function metricLabel(unit: string, period: string): string {
  if (unit) return `Client-stated ${unit.replace(/s$/, "")} metric`;
  if (period) return `Client-stated rate metric`;
  return "Client-stated metric";
}

function metricsInText(text: string): Array<{ value: string; unit: string; period: string }> {
  const found: Array<{ value: string; unit: string; period: string; start: number }> = [];
  const taken: Array<[number, number]> = [];
  for (const { pattern, read } of METRIC_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].trim() === "") {
        pattern.lastIndex += 1;
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      const parsed = read(match);
      if (!parsed || !parsed.value.trim()) continue;
      taken.push([start, end]);
      found.push({ ...parsed, start });
    }
  }
  return found
    .sort((a, b) => a.start - b.start)
    .slice(0, 4)
    .map(({ value, unit, period }) => ({ value, unit, period }));
}

export function baselineStatusFor(metrics: ExtractedMetric[]): BaselineStatus {
  if (metrics.length === 0) return "Missing";
  return metrics.some(
    (metric) =>
      metric.label.trim() &&
      metric.value.trim() &&
      // A baseline needs a counted number, not an approximate phrase like "a couple of weeks".
      /\d/.test(metric.value) &&
      metric.unit.trim() &&
      metric.period.trim() &&
      metric.quote.trim() &&
      metric.speaker.trim() &&
      metric.timestamp.trim() &&
      metric.provenance === "client-stated",
  ) ? "Confirmed" : "Partial";
}

/* ------------------------------------------------------------ text matching */

function contentWords(value: string): string[] {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

function wordSet(value: string): Set<string> {
  return new Set(contentWords(value));
}

function overlap(a: Set<string>, b: Set<string>): { shared: number; score: number } {
  if (a.size === 0 || b.size === 0) return { shared: 0, score: 0 };
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return { shared, score: shared / Math.min(a.size, b.size) };
}

function classifyResolution(text: string): TranscriptContradiction["resolution"] {
  // Negation is checked first: "that's not correct" contains an affirmation word.
  if (NEGATION_PATTERN.test(text)) return "client-corrected";
  if (AFFIRMATION_PATTERN.test(text)) return "client-confirmed";
  return "unresolved";
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function clientLinesOf(lines: TranscriptLine[]): TranscriptLine[] {
  return lines.filter((line) => line.provenance === "client-stated");
}

function firstSentenceWith(text: string, pattern: RegExp): string {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [];
  const hit = sentences.map((sentence) => sentence.trim()).find((sentence) => sentence && pattern.test(sentence));
  return (hit ?? text).trim().slice(0, 240);
}

/* -------------------------------------------------------------- reconciling */

type FactMatch = {
  fact: EvidenceClaim;
  line: TranscriptLine;
  resolution: TranscriptContradiction["resolution"];
};

function matchResearchFacts(lines: TranscriptLine[], research?: ResearchSynthesis): FactMatch[] {
  const facts = (research?.facts ?? []).filter((fact) => typeof fact?.statement === "string" && fact.statement.trim());
  if (facts.length === 0) return [];
  const factSets = facts.map((fact) => ({ fact, words: wordSet(fact.statement) }));
  const matches: FactMatch[] = [];
  for (const line of clientLinesOf(lines)) {
    const lineWords = wordSet(line.text);
    if (lineWords.size < 2) continue;
    let best: { fact: EvidenceClaim; score: number } | null = null;
    for (const candidate of factSets) {
      const { shared, score } = overlap(lineWords, candidate.words);
      if (shared < 2 || score < 0.5) continue;
      if (!best || score > best.score) best = { fact: candidate.fact, score };
    }
    if (best) matches.push({ fact: best.fact, line, resolution: classifyResolution(line.text) });
  }
  return matches.slice(0, 25);
}

function contradictionsFrom(matches: FactMatch[]): TranscriptContradiction[] {
  return matches.map(({ fact, line, resolution }) => {
    const block = canonicalCanvasBlock(fact.canvasBlock);
    const entry: TranscriptContradiction = {
      researchStatement: fact.statement,
      clientQuote: line.text,
      speaker: line.speaker,
      timestamp: line.timestamp,
      resolution,
    };
    if (fact.sourceUrl) entry.researchSourceUrl = fact.sourceUrl;
    if (block) entry.canvasBlock = block;
    return entry;
  });
}

function canvasUpdatesFrom(
  lines: TranscriptLine[],
  matches: FactMatch[],
  questions: DiscoveryQuestion[],
  canvas?: Record<string, EvidenceClaim[]>,
): CanvasUpdate[] {
  const updates: CanvasUpdate[] = [];
  const routed = new Set<string>();
  for (const { fact, line, resolution } of matches) {
    const block = canonicalCanvasBlock(fact.canvasBlock);
    if (!block) continue;
    const update: CanvasUpdate = {
      canvasBlock: block,
      statement: line.text,
      quote: line.text,
      speaker: line.speaker,
      timestamp: line.timestamp,
      // Only the client's own words ever land on the Canvas as client evidence.
      provenance: "client-stated",
    };
    if (resolution === "client-corrected") update.replacesResearchStatement = fact.statement;
    updates.push(update);
    routed.add(`${line.timestamp}|${line.text}`);
  }
  const questionSets = questions
    .filter((question) => typeof question?.question === "string" && question.question.trim())
    .map((question) => ({ question, words: wordSet(question.question) }));
  if (questionSets.length > 0) {
    for (const line of clientLinesOf(lines)) {
      if (routed.has(`${line.timestamp}|${line.text}`)) continue;
      const lineWords = wordSet(line.text);
      if (lineWords.size < 3) continue;
      let best: { question: DiscoveryQuestion; score: number } | null = null;
      for (const candidate of questionSets) {
        const { shared, score } = overlap(lineWords, candidate.words);
        if (shared < 2 || score < 0.4) continue;
        if (!best || score > best.score) best = { question: candidate.question, score };
      }
      if (!best) continue;
      const block = canonicalCanvasBlock(best.question.canvasBlock) ?? SECTION_BLOCKS[best.question.section];
      if (!block) continue;
      updates.push({
        canvasBlock: block,
        statement: line.text,
        quote: line.text,
        speaker: line.speaker,
        timestamp: line.timestamp,
        provenance: "client-stated",
      });
      routed.add(`${line.timestamp}|${line.text}`);
    }
  }
  // Do not re-propose what the Canvas already records as client evidence.
  const existing = new Set<string>();
  for (const [block, claims] of Object.entries(canvas ?? {})) {
    for (const claim of claims ?? []) {
      if (claim?.provenance === "client-stated" && typeof claim.statement === "string") {
        existing.add(`${canonicalCanvasBlock(block) ?? block}|${claim.statement.trim().toLowerCase()}`);
      }
    }
  }
  return updates
    .filter((update) => !existing.has(`${update.canvasBlock}|${update.statement.trim().toLowerCase()}`))
    .slice(0, 25);
}

function stepVocabulary(step: ValueFlowStep): Set<string> {
  return wordSet([step.name, step.input, step.output, step.actor, step.system].filter(Boolean).join(" "));
}

function flowConfirmationsFrom(
  lines: TranscriptLine[],
  valueFlow: ValueFlowStep[],
): NonNullable<TranscriptSynthesis["flowConfirmations"]> {
  const client = clientLinesOf(lines);
  return valueFlow.map((step) => {
    const vocabulary = stepVocabulary(step);
    let best: { line: TranscriptLine; score: number } | null = null;
    for (const line of client) {
      const { shared, score } = overlap(wordSet(line.text), vocabulary);
      if (shared < 2 || score < 0.35) continue;
      if (!best || score > best.score) best = { line, score };
    }
    if (!best) {
      return { flowStepId: step.id, status: "unconfirmed" as const, quote: "", speaker: "", timestamp: "" };
    }
    return {
      flowStepId: step.id,
      status: NEGATION_PATTERN.test(best.line.text) ? ("corrected" as const) : ("confirmed" as const),
      quote: best.line.text,
      speaker: best.line.speaker,
      timestamp: best.line.timestamp,
    };
  });
}

function matchingFlowStep(text: string, valueFlow: ValueFlowStep[]): ValueFlowStep | null {
  const words = wordSet(text);
  let best: { step: ValueFlowStep; score: number } | null = null;
  for (const step of valueFlow) {
    const { shared, score } = overlap(words, stepVocabulary(step));
    if (shared < 2 || score < 0.35) continue;
    if (!best || score > best.score) best = { step, score };
  }
  return best?.step ?? null;
}

function decisionsFrom(lines: TranscriptLine[]): TranscriptDecision[] {
  // Client lines only: an advisor's suggestion is not the client's decision.
  return clientLinesOf(lines)
    .filter((line) => DECISION_PATTERN.test(line.text))
    .map((line) => ({
      decision: firstSentenceWith(line.text, DECISION_PATTERN),
      quote: line.text,
      speaker: line.speaker,
      timestamp: line.timestamp,
      owner: line.speaker,
    }))
    .slice(0, 25);
}

function tasksFrom(lines: TranscriptLine[], valueFlow: ValueFlowStep[], people: string[]): TranscriptTask[] {
  return clientLinesOf(lines)
    .filter((line) => TASK_PATTERN.test(line.text))
    .map((line) => {
      const step = matchingFlowStep(line.text, valueFlow);
      const task: TranscriptTask = {
        task: firstSentenceWith(line.text, TASK_PATTERN),
        quote: line.text,
        speaker: line.speaker,
        timestamp: line.timestamp,
        owner: taskOwner(line, people),
      };
      if (step) task.flowStepId = step.id;
      return task;
    })
    .slice(0, 25);
}

/** An owner is only set when a person is actually named; otherwise it stays empty. */
function taskOwner(line: TranscriptLine, people: string[]): string {
  if (/\b(i'll|i will|i'm going to|i am going to)\b/i.test(line.text)) return line.speaker;
  const named = people.find((person) => mentionsPerson(line.text, person));
  return named ?? "";
}

function mentionsPerson(text: string, person: string): boolean {
  const clean = person.trim();
  if (!clean) return false;
  const haystack = text.toLowerCase();
  if (haystack.includes(clean.toLowerCase())) return true;
  const first = clean.split(/\s+/)[0];
  return first.length >= 3 && new RegExp(`\\b${escapeRegExp(first.toLowerCase())}\\b`).test(haystack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flowPeople(valueFlow: ValueFlowStep[]): string[] {
  const names: string[] = [];
  for (const step of valueFlow) {
    for (const part of (step.actor ?? "").split(/[,/&]|\band\b/i)) {
      const name = part.trim().replace(/\s+/g, " ");
      if (!name || name.length > 60 || !/[a-z]/i.test(name)) continue;
      if (!names.some((existing) => existing.toLowerCase() === name.toLowerCase())) names.push(name);
    }
  }
  return names;
}

/**
 * Role decomposition is limited to people who appear inside the traced value flow.
 * Fields stay empty when the transcript does not say; nothing here is inferred.
 */
function rolesFrom(lines: TranscriptLine[], valueFlow: ValueFlowStep[], tasks: TranscriptTask[]): RoleMapEntry[] {
  const people = flowPeople(valueFlow);
  const client = clientLinesOf(lines);
  return people.map((person) => {
    const mentions = client.filter(
      (line) => mentionsPerson(line.text, person) || mentionsPerson(line.speaker, person),
    );
    const corpus = mentions.map((line) => line.text).join(" ");
    const responsibilities = valueFlow
      .filter((step) => mentionsPerson(step.actor ?? "", person))
      .map((step) => step.name)
      .filter(Boolean);
    const ownedTasks = tasks.filter((task) => task.owner && mentionsPerson(task.owner, person)).map((task) => task.task);
    const judgment = JUDGMENT_PATTERN.test(corpus);
    const grind = GRIND_PATTERN.test(corpus);
    return {
      person,
      reportsTo: "",
      responsibilities,
      tasks: ownedTasks,
      doesTask: responsibilities.length > 0,
      accountableForOutcome: ACCOUNTABLE_PATTERN.test(corpus),
      // "mixed" is the unclassified value; it asserts nothing the transcript did not say.
      judgmentOrGrind: judgment && !grind ? "judgment" : grind && !judgment ? "grind" : "mixed",
      approvalAuthority: APPROVAL_PATTERN.test(corpus) ? firstSentenceWith(corpus, APPROVAL_PATTERN) : "",
      singlePointDependency: SINGLE_POINT_PATTERN.test(corpus),
    };
  });
}

function speakerSummaryFrom(lines: TranscriptLine[]): NonNullable<TranscriptSynthesis["speakerSummary"]> {
  const counts = new Map<string, { lines: number; provenance: TranscriptLine["provenance"] }>();
  for (const line of lines) {
    const existing = counts.get(line.speaker);
    if (existing) existing.lines += 1;
    else counts.set(line.speaker, { lines: 1, provenance: line.provenance });
  }
  return Array.from(counts.entries()).map(([speaker, entry]) => ({
    speaker,
    lines: entry.lines,
    provenance: entry.provenance,
  }));
}

function unansweredRequiredQuestions(questions: DiscoveryQuestion[], lines: TranscriptLine[]): DiscoveryQuestion[] {
  const client = clientLinesOf(lines).map((line) => wordSet(line.text));
  return questions.filter((question) => {
    if (!question?.required || typeof question.question !== "string") return false;
    const words = wordSet(question.question);
    return !client.some((lineWords) => {
      const { shared, score } = overlap(lineWords, words);
      return shared >= 2 && score >= 0.35;
    });
  });
}

function candidateFor(
  lines: TranscriptLine[],
  valueFlow: ValueFlowStep[],
): (typeof CONSTRAINT_SIGNALS)[number] | null {
  const client = clientLinesOf(lines);
  if (client.length === 0) return null;
  const flowVocabulary = valueFlow.map((step) => stepVocabulary(step));
  const scored = CONSTRAINT_SIGNALS.map((signal) => {
    let score = 0;
    for (const line of client) {
      const text = line.text.toLowerCase();
      const hits = signal.words.reduce((sum, word) => sum + countOccurrences(text, word), 0);
      if (hits === 0) continue;
      score += hits; // repetition across the call
      const words = wordSet(line.text);
      // proximity: the same line also describes a traced value-flow step
      if (flowVocabulary.some((vocabulary) => overlap(words, vocabulary).shared >= 2)) score += 1;
    }
    return { signal, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score > 0 ? scored[0].signal : null;
}

/* -------------------------------------------------------------- synthesis */

export function synthesizeTranscript(
  text: string,
  options: {
    client: string;
    callNumber: 1 | 2;
    transcriptUrl?: string;
    humanOwner?: { name: string; role: string };
    speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
    research?: ResearchSynthesis;
    canvas?: Record<string, EvidenceClaim[]>;
    valueFlow?: ValueFlowStep[];
    questions?: DiscoveryQuestion[];
    priorSynthesis?: TranscriptSynthesis[];
  },
): TranscriptSynthesis {
  const lines = parseTranscriptText(text, options.speakerRoles);
  const metrics = extractMetrics(lines);
  const baselineStatus = baselineStatusFor(metrics);
  const valueFlow = options.valueFlow ?? options.research?.valueFlow ?? [];
  const questions = options.questions ?? options.research?.discoveryQuestions ?? [];
  const factMatches = matchResearchFacts(lines, options.research);
  const contradictions = contradictionsFrom(factMatches);
  const canvasUpdates = canvasUpdatesFrom(lines, factMatches, questions, options.canvas);
  const flowConfirmations = flowConfirmationsFrom(lines, valueFlow);
  const decisions = decisionsFrom(lines);
  const people = flowPeople(valueFlow);
  const tasks = tasksFrom(lines, valueFlow, people);
  const roles = rolesFrom(lines, valueFlow, tasks);
  const speakerSummary = speakerSummaryFrom(lines);
  const candidate = candidateFor(lines, valueFlow);

  const priorCandidates = (options.priorSynthesis ?? [])
    .map((entry) => entry?.constraintCandidate)
    .filter((entry): entry is ConstraintFinding => Boolean(entry));
  const priorConflict =
    candidate !== null &&
    priorCandidates.some((prior) => prior.constraintType !== candidate.type);

  const sharedGaps = collectGaps({
    lines,
    baselineStatus,
    contradictions,
    flowConfirmations,
    valueFlow,
    questions,
    humanOwner: options.humanOwner,
    priorConflict,
    priorCandidates,
    candidateType: candidate?.type ?? null,
  });

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
        ...sharedGaps,
      ],
      constraintCandidate: null,
      contradictions,
      decisions,
      tasks,
      canvasUpdates,
      flowConfirmations,
      roles,
      analysisMode: "deterministic",
      speakerSummary,
    };
  }

  const scoredQuotes = clientLinesOf(lines)
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
  // Verification still requires call 2 AND a confirmed baseline; a conflict with call 1 blocks it.
  const isConfirmed = baselineStatus === "Confirmed" && options.callNumber === 2 && !priorConflict;
  const metric = metrics.find((item) => item.period && /\d/.test(item.value)) ?? metrics[0];
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
    symptoms: evidence.map((item) => ({
      statement: item.quote,
      number: metricsInText(item.quote)[0]?.value ?? "",
    })),
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
    gaps: baselineStatus === "Confirmed"
      ? sharedGaps
      : [
          "Confirm one baseline metric with value, unit, period, source, and accountable owner.",
          ...sharedGaps,
        ],
    constraintCandidate: finding,
    contradictions,
    decisions,
    tasks,
    canvasUpdates,
    flowConfirmations,
    roles,
    analysisMode: "deterministic",
    speakerSummary,
  };
}

function collectGaps(input: {
  lines: TranscriptLine[];
  baselineStatus: BaselineStatus;
  contradictions: TranscriptContradiction[];
  flowConfirmations: NonNullable<TranscriptSynthesis["flowConfirmations"]>;
  valueFlow: ValueFlowStep[];
  questions: DiscoveryQuestion[];
  humanOwner?: { name: string; role: string };
  priorConflict: boolean;
  priorCandidates: ConstraintFinding[];
  candidateType: ConstraintType | null;
}): string[] {
  const gaps: string[] = [];
  const unmapped = input.lines.filter((line) => line.provenance === "gap").length;
  if (unmapped > 0) {
    gaps.push(`${unmapped} line(s) have no mapped speaker and cannot be used as client evidence until an advisor maps them.`);
  }
  if (clientLinesOf(input.lines).length === 0) {
    gaps.push("No line is attributed to a client speaker; nothing in this transcript can support a finding.");
  }
  if (!input.humanOwner?.name?.trim()) {
    gaps.push("No named human owner is recorded for the constraint.");
  }
  for (const contradiction of input.contradictions.filter((item) => item.resolution === "unresolved").slice(0, 5)) {
    gaps.push(`Research claim still unresolved on the call: "${contradiction.researchStatement}".`);
  }
  const unconfirmed = input.flowConfirmations.filter((item) => item.status === "unconfirmed");
  if (unconfirmed.length > 0) {
    const names = unconfirmed
      .map((item) => input.valueFlow.find((step) => step.id === item.flowStepId)?.name || item.flowStepId)
      .slice(0, 5);
    gaps.push(`Value flow step(s) not confirmed by the client: ${names.join(", ")}.`);
  }
  for (const question of unansweredRequiredQuestions(input.questions, input.lines).slice(0, 8)) {
    gaps.push(`Required discovery question unanswered (${question.section}): ${question.question}`);
  }
  if (input.priorConflict && input.candidateType) {
    const priorTypes = Array.from(new Set(input.priorCandidates.map((prior) => prior.constraintType))).join(", ");
    gaps.push(
      `This call points to a ${input.candidateType} constraint while the prior call pointed to ${priorTypes}; the finding stays provisional until the client resolves the conflict.`,
    );
  }
  return gaps;
}
