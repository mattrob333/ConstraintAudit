import { mergeCanvas, type Canvas } from "./canvas";
import {
  CANVAS_BLOCKS,
  canonicalCanvasBlock,
  type CatalogEntry,
  type ConstraintFinding,
  type Engagement,
  type EvidenceClaim,
  type ExtractedMetric,
  type OutcomeMeasurement,
  type Provenance,
  type RoleMapEntry,
  type SprintRecord,
  type TranscriptSynthesis,
  type ValueFlowStep,
} from "./workflow";

/**
 * Up to `limit` things we could not learn from public information, phrased as questions.
 *
 * Discovery questions are used first because they are already interrogative and already anchored
 * to a fact or a gap. A research gap is a statement about what public sources fail to say — never
 * about the client — so when one is used as a fallback it is wrapped into a question rather than
 * printed as a finding about their business.
 */
function researchCuriosities(engagement: Engagement, limit = 2): string[] {
  const research = engagement.data.research;
  const questions = (research?.discoveryQuestions ?? []).filter((item) => text(item?.question));
  // A question that tests something we actually read on their site ("your contact page says quotes
  // come back within 48 hours") is worth far more here than a generic one: it shows we did the
  // reading before asking for their hour. `publicAssumption` is recorded as "None…" when research
  // found nothing, so a cited source is what separates the two.
  const grounded = (item: (typeof questions)[number]): boolean =>
    (item.sourceUrls?.length ?? 0) > 0 && !/^none\b/i.test(text(item.publicAssumption));
  // Ordered for a brief the client reads *before* the call: a public promise to test, then who
  // does what, then how work arrives. A "which step costs you work" question belongs in the room.
  const sectionRank = ["promise", "roles", "demand", "flow", "baseline", "constraint", "feasibility"];
  const rankOf = (section: string): number => {
    const at = sectionRank.indexOf(section);
    return at === -1 ? sectionRank.length : at;
  };
  const ranked = [
    ...questions.filter(grounded).sort((a, b) => rankOf(a.section) - rankOf(b.section)),
    ...questions.filter((item) => !grounded(item) && item.required),
    ...questions.filter((item) => !grounded(item) && !item.required),
  ];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    const question = text(item.question);
    if (seen.has(question.toLowerCase())) continue;
    seen.add(question.toLowerCase());
    lines.push(question);
    if (lines.length >= limit) return lines;
  }
  for (const gap of research?.gaps ?? []) {
    const statement = text(gap);
    if (!statement || seen.has(statement.toLowerCase())) continue;
    seen.add(statement.toLowerCase());
    lines.push(`${statement.replace(/[.\s]+$/, "")}. Could you walk us through how that actually works?`);
    if (lines.length >= limit) break;
  }
  return lines;
}

/** "12 May 2026 at 14:00 UTC" from a stored ISO timestamp; "" when nothing is scheduled. */
function scheduledLine(value: string | null | undefined): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(text(value));
  if (!match) return "";
  return `${formatDocumentDate(match[1])} at ${match[2]}:${match[3]} UTC`;
}

export function generateReadinessBrief(
  engagement: Engagement,
  logistics: {
    videoLink?: string;
    duration?: string;
    /** From the advisor's letterhead, so the first thing a client reads carries a person's name. */
    advisorName?: string;
    firmName?: string;
  } = {},
): string {
  const contact = text(engagement.primaryContact);
  const advisor = text(logistics.advisorName) || text(engagement.advisor);
  const firm = text(logistics.firmName);
  const byline = [advisor, firm].filter(Boolean).join(", ");
  const scheduled = scheduledLine(engagement.call1At);
  const curiosities = researchCuriosities(engagement);
  const salutation = [
    contact ? `Prepared for ${contact} at ${engagement.client}` : `Prepared for ${engagement.client}`,
    byline ? `by ${byline}` : "",
  ].filter(Boolean).join(" ") + ".";
  return `# ${engagement.client} — Pre-Call Readiness Brief

${salutation}${scheduled ? `\n\nScheduled: ${scheduled}.` : ""}

## What the session is

${contact ? `${contact}, we'll` : "We'll"} walk through a map of your business we've drafted from public information. You correct it. Expect specific questions about how work actually flows.
${curiosities.length
  ? `
## What we want to understand

We could not answer these from the outside. They are questions, not conclusions — we have not assumed an answer to any of them:

${curiosities.map((line) => `- ${line}`).join("\n")}
`
  : ""}
## Who should attend

The owner or decision-maker, plus the person who can speak to the daily operation of the main workflow.

If one person prices, estimates, schedules, or approves everything, we'd love them in the room or available.

## Have these within reach

- Monthly volumes such as bids, orders, invoices, or leads
- Typical end-to-end turnaround time
- What is currently waiting in queue
- Anything declined, missed, or turned away last quarter
- Rough cost or revenue figures you would stand behind

Approximate is fine. No reports, no spreadsheets — we just don't want you hunting for numbers live.

## Logistics

- When: ${scheduled || "To be confirmed"}
- Video link: ${logistics.videoLink?.trim() || "To be confirmed"}
- Duration: ${logistics.duration?.trim() || "60 minutes"}
- Recording: With your permission, we'll record and transcribe the session so we quote you accurately rather than paraphrasing you.
`;
}

function metricLabel(finding: ConstraintFinding): string {
  const metric = finding.baselineMetric;
  if (!metric.value) return "Missing — baseline instrumentation is the first Sprint 1 task.";
  return [metric.value, metric.unit, metric.period].filter(Boolean).join(" ");
}

export function generateDiagnosisPackage(engagement: Engagement, finding: ConstraintFinding): string {
  const provisional = finding.findingStatus === "provisional" || !finding.baselineMetric.value;
  const evidence = finding.evidence.length
    ? finding.evidence.map((item) => `- “${item.quote}” — ${item.speaker}, ${item.timestamp}`).join("\n")
    : "- No client-stated supporting quote has been captured.";
  return `# ${engagement.client} — ${provisional ? "Provisional Diagnosis" : "Diagnosis Package"}

## One constraint

${clientConstraintHeadline(finding)}

${evidence}

## One prescription

${finding.prescription.description}

Why this is the smallest intervention: ${finding.prescription.whySmallestIntervention}

## One metric

Baseline: ${metricLabel(finding)}

${provisional
  ? `Projected delta remains a formula only: \`${finding.projectedDelta.formula}\`\n\nRequired inputs: ${finding.projectedDelta.namedInputs.join(", ")}`
  : `Projected delta formula: \`${finding.projectedDelta.formula}\`\n\nNo numeric projection is claimed until the ending metric is measured.`}

## One named human owner

${finding.humanOwner.name || "Missing owner"}${finding.humanOwner.role ? ` — ${finding.humanOwner.role}` : ""}

## Predicted next constraint

${finding.predictedNextConstraint}

## Not the constraint — revisit after it moves

${finding.appendixItems.length ? finding.appendixItems.map((item) => `- ${item}`).join("\n") : "- None recorded."}
`;
}

/* ------------------------------------------------------------------ *
 * Shared, evidence-safe helpers
 * ------------------------------------------------------------------ */

const MISSING_BLOCK = "- Missing — no public source supported this block; confirm with client evidence.";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ownerLabel(owner: { name: string; role: string } | undefined): string {
  const name = text(owner?.name);
  const role = text(owner?.role);
  if (!name) return "Missing — a named human owner is still required";
  return role ? `${name} (${role})` : name;
}

function ownerName(finding: ConstraintFinding): string {
  return text(finding.humanOwner?.name) || "the named owner";
}

/** The constraint's Canvas block, normalized to the canonical nine where possible. */
function constraintBlock(finding: ConstraintFinding): string {
  const block = canonicalCanvasBlock(finding.canvasBlock) ?? text(finding.canvasBlock);
  return block || "an unassigned Canvas block";
}

function claimLine(claim: EvidenceClaim): string {
  const source = claim.sourceUrl ? `[${claim.sourceLabel}](${claim.sourceUrl})` : claim.sourceLabel;
  return `- ${claim.statement} _(${claim.provenance}; ${Math.round(claim.confidence * 100)}% confidence)_ — ${source}`;
}

function engagementCanvas(engagement: Engagement): Canvas {
  return mergeCanvas({}, engagement.data.canvas);
}

function valueFlowSteps(engagement: Engagement): ValueFlowStep[] {
  const flow = engagement.data.valueFlow;
  if (!Array.isArray(flow)) return [];
  return [...flow].filter((step) => step && typeof step === "object").sort((a, b) => a.order - b.order);
}

function synthesisRecords(engagement: Engagement): TranscriptSynthesis[] {
  const records = engagement.data.transcriptSynthesis;
  return Array.isArray(records) ? records : [];
}

type FlowConfirmation = NonNullable<TranscriptSynthesis["flowConfirmations"]>[number];

/** Live confirmation of a proposed flow step, if the client actually spoke to it. */
function flowConfirmation(engagement: Engagement, stepId: string): FlowConfirmation | null {
  for (const record of synthesisRecords(engagement)) {
    for (const confirmation of record.flowConfirmations ?? []) {
      if (confirmation.flowStepId === stepId) return confirmation;
    }
  }
  return null;
}

/**
 * Best-effort location of the constraint in the traced flow: a step is only named when
 * its own name appears in the finding's own words. No guessing by position.
 */
function constraintStep(engagement: Engagement, finding: ConstraintFinding): ValueFlowStep | null {
  const steps = valueFlowSteps(engagement);
  if (!steps.length) return null;
  const haystack = [
    finding.prescription?.description,
    finding.prescription?.whySmallestIntervention,
    finding.predictedNextConstraint,
    ...(finding.symptoms ?? []).map((symptom) => symptom.statement),
    ...(finding.evidence ?? []).map((item) => item.quote),
  ]
    .map((entry) => text(entry).toLowerCase())
    .join(" ");
  if (!haystack) return null;
  return steps.find((step) => {
    const name = text(step.name).toLowerCase();
    return name.length > 3 && haystack.includes(name);
  }) ?? null;
}

function constraintStepLine(engagement: Engagement, finding: ConstraintFinding): string {
  const step = constraintStep(engagement, finding);
  if (!step) {
    return "Flow step: not yet located in the traced value flow — confirm with the client which step carries the constraint.";
  }
  const confirmation = flowConfirmation(engagement, step.id);
  const status = confirmation
    ? `client-${confirmation.status}`
    : `unconfirmed (${step.evidenceStatus})`;
  return `Flow step ${step.order}: **${step.name}** — ${text(step.actor) || "actor not named"} working in ${text(step.system) || "an unnamed system"} (${status}).`;
}

/**
 * A unit the value's own symbol has already stated. Appending it produced "$25,000 dollars" and
 * "20% percent" — the two most visible proofreading failures in the proposal.
 */
const SYMBOL_UNITS: Array<[RegExp, RegExp]> = [
  [/%/, /^(percent|percentage|pct|%)$/i],
  [/\$/, /^(dollars?|usd|\$)$/i],
  [/£/, /^(pounds?|gbp|£)$/i],
  [/€/, /^(euros?|eur|€)$/i],
];

/** A stored period that is already a phrase ("per quote", "a month") rather than a bare noun. */
const PERIOD_PREPOSITION = /^(per|a|an|each|every)\b/i;

/**
 * One extracted figure, written the way a person would say it.
 *
 * The extractor stores a value, a unit and a period as three separate strings, and the value often
 * already carries one of them ("9 days"). Joining them blindly is where every malformed line in the
 * proposal came from: "four years years", "20% percent", "$25,000 dollars", "30 requests month",
 * "9 days quote". This is the single place that decides how the three become one phrase:
 *
 *  - a unit the value already contains, or that its currency/percent symbol already states, is dropped;
 *  - a bare-noun period gets the preposition the extractor dropped, so it reads "per quote".
 */
export function measureLabel(value: string, unit: string, period: string): string {
  const measure = text(value);
  if (!measure) return "";
  const lower = measure.toLowerCase();
  const rawUnit = text(unit);
  const symbolStated = SYMBOL_UNITS.some(([symbol, name]) => symbol.test(measure) && name.test(rawUnit));
  const unitPart = rawUnit && !symbolStated && !lower.includes(rawUnit.toLowerCase()) ? ` ${rawUnit}` : "";
  const rawPeriod = text(period);
  if (!rawPeriod) return `${measure}${unitPart}`;
  const periodLower = rawPeriod.toLowerCase();
  if (lower.includes(periodLower)) return `${measure}${unitPart}`;
  const periodPart = PERIOD_PREPOSITION.test(periodLower) ? rawPeriod : `per ${rawPeriod}`;
  return `${measure}${unitPart} ${periodPart}`;
}

/** Only numbers the client actually said, each still carrying its quote. */
function clientStatedNumbers(engagement: Engagement, finding: ConstraintFinding): string[] {
  const lines: string[] = [];
  for (const symptom of finding.symptoms ?? []) {
    const number = text(symptom.number);
    if (number) lines.push(`- ${number} — ${text(symptom.statement) || "symptom recorded without a statement"}`);
  }
  // The generated label is dropped entirely — "Client-stated year metric" is not language to read
  // to a client — and the three stored parts are composed by measureLabel above.
  const seen = new Set<string>();
  for (const record of synthesisRecords(engagement)) {
    for (const metric of record.metrics ?? []) {
      const measure = measureLabel(metric.value, metric.unit, metric.period);
      if (!measure) continue;
      const quote = text(metric.quote);
      // Overlapping extraction patterns can match the same figure in one line twice.
      const key = `${measure.toLowerCase()}|${quote.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ${measure} — “${quote}” (${text(metric.speaker)}, ${text(metric.timestamp)})`);
    }
  }
  return lines;
}

/**
 * A client call contains every number the client happened to say — the age of their website,
 * how long a former hire lasted. Reading all of them back is noise that undermines the
 * advisor, so a client-facing page keeps only the figures that bear on this constraint.
 */
function constraintRelevantNumbers(
  engagement: Engagement,
  finding: ConstraintFinding,
  limit = 6,
): string[] {
  const all = clientStatedNumbers(engagement, finding);
  const baselineTerms = [
    text(finding.baselineMetric?.unit),
    text(finding.baselineMetric?.period),
    text(finding.baselineMetric?.value),
  ].filter(Boolean).map((term) => term.toLowerCase());
  const evidenceQuotes = (finding.evidence ?? [])
    .map((item) => text(item.quote).toLowerCase())
    .filter(Boolean);

  const scored = all.map((line) => {
    const lower = line.toLowerCase();
    // Symptom-derived lines are advisor-recorded against this finding, so they always belong.
    const isSymptom = !lower.includes("“");
    const matchesBaseline = baselineTerms.some((term) => lower.includes(term));
    const inEvidence = evidenceQuotes.some((quote) => quote && lower.includes(quote.slice(0, 40)));
    return { line, score: (isSymptom ? 4 : 0) + (matchesBaseline ? 2 : 0) + (inEvidence ? 1 : 0) };
  });
  const relevant = scored.filter((item) => item.score > 0);
  // If nothing scored, the honest answer is the unfiltered list rather than an empty page.
  return (relevant.length ? relevant : scored)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.line);
}

function evidenceQuotes(finding: ConstraintFinding): string {
  const evidence = finding.evidence ?? [];
  return evidence.length
    ? evidence.map((item) => `> “${item.quote}”\n>\n> — ${item.speaker}, ${item.timestamp}`).join("\n\n")
    : "No client-stated quote is on record. This document may not be sent as a finding until one is captured.";
}

/**
 * A numeric projection is only ever printed when the client has confirmed a starting
 * number. Without a baseline there is nothing to project from, so nothing is claimed.
 */
function projectionBlock(finding: ConstraintFinding): string {
  const formula = text(finding.projectedDelta?.formula) || "not yet defined";
  const inputs = (finding.projectedDelta?.namedInputs ?? []).filter(Boolean);
  if (!text(finding.baselineMetric?.value)) {
    return `The baseline for ${text(finding.baselineMetric?.name) || "the constraint metric"} is Missing, so no number, range, or ROI is claimed here.

Formula only: \`${formula}\`

Required inputs before any number is stated: ${inputs.length ? inputs.join(", ") : "not yet named"}.`;
  }
  const range = ["low", "base", "high"]
    .map((key) => [key, text(finding.projectedDelta?.[key as "low" | "base" | "high"])] as const)
    .filter(([, value]) => value);
  return `Confirmed baseline: ${metricLabel(finding)} (source: ${text(finding.baselineMetric?.source) || "unrecorded"}).

Formula: \`${formula}\`

${range.length
    ? `${range.map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\nConfidence: ${text(finding.projectedDelta?.confidence) || "unstated"}. Every figure derives from the confirmed baseline above and the named inputs: ${inputs.length ? inputs.join(", ") : "not yet named"}.`
    : "No range has been recorded, so no number is claimed."}`;
}

/* ------------------------------------------------------------------ *
 * Audit report
 * ------------------------------------------------------------------ */

function evidenceSummary(canvas: Canvas): string {
  const tally: Record<Provenance, number> = {
    "client-stated": 0,
    doc: 0,
    "public-research": 0,
    "advisor-note": 0,
    gap: 0,
  };
  let emptyBlocks = 0;
  for (const block of CANVAS_BLOCKS) {
    const claims = canvas[block];
    if (!claims.length) emptyBlocks += 1;
    for (const claim of claims) tally[claim.provenance] += 1;
  }
  const total = Object.values(tally).reduce((sum, count) => sum + count, 0);
  return `## Evidence summary

- Client-stated claims: ${tally["client-stated"]}
- Client document claims: ${tally.doc}
- Public-research claims: ${tally["public-research"]}
- Advisor notes: ${tally["advisor-note"]}
- Unsupported entries: ${tally.gap}
- Blocks with no evidence at all: ${emptyBlocks} of ${CANVAS_BLOCKS.length}

${total === 0
  ? "Nothing on this Canvas is evidenced yet. Treat every block as an open question."
  : `${tally["client-stated"]} of ${total} claims are confirmed by the client in their own words. Everything else remains public research or advisor inference and must not be read as fact.`}`;
}

function valueFlowSection(engagement: Engagement): string {
  const steps = valueFlowSteps(engagement);
  if (!steps.length) return "";
  const body = steps
    .map((step, index) => {
      const confirmation = flowConfirmation(engagement, step.id);
      const evidence = confirmation && confirmation.status !== "unconfirmed"
        ? `Client-${confirmation.status}: “${text(confirmation.quote)}” — ${text(confirmation.speaker)}, ${text(confirmation.timestamp)}`
        : `**Unconfirmed** (${step.evidenceStatus}, ${Math.round((step.confidence ?? 0) * 100)}% confidence) — ask: ${text(step.confirmationQuestion) || "confirm this step with the client."}`;
      return [
        `${index + 1}. **${text(step.name) || "Unnamed step"}** — ${text(step.description) || "no description recorded"}`,
        `   - Actor: ${text(step.actor) || "Missing — not named"}`,
        `   - System: ${text(step.system) || "Missing — not named"}`,
        `   - Input → output: ${text(step.input) || "unrecorded"} → ${text(step.output) || "unrecorded"}`,
        `   - Evidence: ${evidence}`,
      ].join("\n");
    })
    .join("\n");
  return `## Value flow

${body}

Steps marked **Unconfirmed** are proposed from public research only. They are questions, not findings.

`;
}

export function generateAuditReport(engagement: Engagement, finding: ConstraintFinding): string {
  const canvas = engagementCanvas(engagement);
  return `# ${engagement.client} — Throughput Audit Report

## Business Model Canvas

${CANVAS_BLOCKS.map((block) => {
  const claims = canvas[block];
  return `### ${block}\n\n${claims.length ? claims.map(claimLine).join("\n") : MISSING_BLOCK}`;
}).join("\n\n")}

${evidenceSummary(canvas)}

${valueFlowSection(engagement)}${generateDiagnosisPackage(engagement, finding)}
`;
}

/* ------------------------------------------------------------------ *
 * Proposal
 * ------------------------------------------------------------------ */

/**
 * Current standard price point for the fixed two-week sprint, in USD.
 * This is the single place to change the price: every document reads it from here.
 */
export const FIXED_SPRINT_PRICE_USD = 2500;

/** Thousands grouping without locale data, so the printed price is identical everywhere. */
function usd(amount: number): string {
  return `$${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} USD`;
}

const PRICE_LABEL = usd(FIXED_SPRINT_PRICE_USD);

/**
 * The fee is a fixed fee and nothing else. A payback period, return multiple, or ROI would
 * require a confirmed baseline and a projected delta, neither of which this app invents — so
 * no number is ever printed beside the price.
 */
function investmentSection(finding: ConstraintFinding): string {
  const owner = ownerName(finding);
  const metricName = text(finding.baselineMetric?.name) || "the constraint metric";
  const baselineConfirmed = Boolean(text(finding.baselineMetric?.value));
  const included = [
    `- The sprint scope above, and nothing outside it.`,
    `- ${owner}'s review time: every consequential step is presented for approval as part of the fee.`,
    `- Before-and-after measurement of ${metricName}: the starting reading, the ending reading, and the change between them.`,
  ];
  if (finding.baselineInstrumentation?.required) {
    included.push(`- Instrumenting that starting reading, which is the first task of the sprint.`);
  }
  return `## Investment

**${PRICE_LABEL} — fixed fee** for the two-week sprint described above. Agreed before work starts; it does not move with hours worked.

What the fee includes:

${included.join("\n")}

What the fee does not include:

- Anything listed under "Explicitly out of scope" below.
- Ongoing operation, support, licence, or subscription costs after the sprint ends.
- A second sprint on the next constraint. That is a separate decision, made after this one is measured.

${baselineConfirmed
  ? `The fee is stated on its own. No payback period, return multiple, or ROI is calculated against it, because that would require a projected result this engagement has not measured yet.`
  : `The starting number for ${metricName} is not yet confirmed, so no return, payback period, or multiple is claimed against this fee. Confirming that number is the first task of the sprint; until it is measured, the fee is the only figure in this document.`}`;
}

/**
 * The constraint as the person paying for it reads it.
 *
 * `knowledge constraint in Key Activities.` is our vocabulary, not theirs, and it is the first
 * six words of the document. Client-facing pages print the plain sentence; advisor-facing
 * surfaces — the developer spec, the sprint plan, the catalog entry, the cockpit itself —
 * keep the enum, because that is where the enum is load-bearing.
 */
const CLIENT_CONSTRAINT_HEADLINE: Record<string, string> = {
  capacity: "More work is arriving than this part of the business can get through.",
  latency: "Work sits waiting between steps, so a job takes far longer than the work itself takes.",
  quality: "Work comes back to be redone, so the same job gets paid for twice.",
  knowledge: "The work waits on know-how that lives in one person's head.",
  policy: "A rule or an approval is holding the work back — not the people, and not the tools.",
};

/** The plain-language constraint headline for a client-facing document. */
export function clientConstraintHeadline(finding: ConstraintFinding): string {
  const headline = CLIENT_CONSTRAINT_HEADLINE[finding.constraintType]
    ?? "One step in the flow is limiting how much work gets finished.";
  return `**${headline}** It shows up in ${constraintBlock(finding)}.`;
}

/**
 * When the measurement clock starts, as one readable sentence.
 *
 * The stored value is sometimes a clause ("the price book is first used on a live enquiry") and
 * sometimes a whole sentence of its own. Splicing the second kind into "…starts when X" produced a
 * capital letter mid-sentence and a doubled full stop. A sentence is printed as itself; a clause is
 * completed into one.
 */
function measurementClockSentence(finding: ConstraintFinding): string {
  const raw = text(finding.baselineInstrumentation?.measurementClockStartsWhen);
  if (!raw) return "The measurement clock starts when the starting metric is confirmed and reproducible.";
  const isSentence = /^[A-Z]/.test(raw) && /[.!?][")”’]?$/.test(raw);
  if (isSentence) return raw;
  return `The measurement clock starts when ${raw.replace(/[.\s]+$/, "")}.`;
}

/** "a, b and c" — for a short list of names inside a sentence. */
function sentenceList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A figure the client stated, with the words it came from. Nothing here is computed by us. */
interface StatedFigure {
  label: string;
  figure: string;
  attribution: string;
}

const VOLUME_NOUNS = /\b(quote|quotes|bid|bids|request|requests|enquir\w*|inquir\w*|order|orders|lead|leads|job|jobs|invoice|invoices|ticket|tickets|call|calls|unit|units)\b/i;
const PERIOD_WORDS = /\b(month|week|day|year|quarter)\b/i;
const RATE_WORDS = /\b(win|wins|winning|won|award\w*|convert\w*|conversion|clos\w+|hit rate|success rate)\b/i;

/**
 * The client's own arithmetic: the baseline they confirmed, how much work arrives, and how much of
 * it they win — each only when they actually said it, and each still carrying the line it came from.
 *
 * These are the three numbers an owner needs to work out what the constraint is costing them. We
 * assemble them and stop. Multiplying them together would be a projection, which this product does
 * not make; handing the owner their own figures and the formula is not the same act.
 */
function clientArithmetic(engagement: Engagement, finding: ConstraintFinding): StatedFigure[] {
  const rows: StatedFigure[] = [];
  if (text(finding.baselineMetric?.value)) {
    rows.push({
      label: text(finding.baselineMetric?.name) || "The constraint metric, today",
      figure: metricLabel(finding),
      attribution: text(finding.baselineMetric?.source) || "confirmed on the call",
    });
  }
  const metrics = synthesisRecords(engagement).flatMap((record) => record.metrics ?? []);
  const add = (label: string, match: (metric: ExtractedMetric) => boolean): void => {
    const hit = metrics.find(match);
    if (!hit) return;
    const figure = measureLabel(hit.value, hit.unit, hit.period);
    if (!figure || rows.some((row) => row.figure.toLowerCase() === figure.toLowerCase())) return;
    const quote = text(hit.quote);
    const who = [text(hit.speaker), text(hit.timestamp)].filter(Boolean).join(", ");
    rows.push({
      label,
      figure,
      attribution: quote ? `“${quote}”${who ? ` — ${who}` : ""}` : who || "stated on the call",
    });
  };
  add("How much work arrives", (metric) =>
    PERIOD_WORDS.test(text(metric.period)) &&
    (VOLUME_NOUNS.test(text(metric.unit)) || VOLUME_NOUNS.test(text(metric.value))));
  add("How much of it you win", (metric) =>
    /%|percent/i.test(`${text(metric.value)} ${text(metric.unit)}`) && RATE_WORDS.test(text(metric.quote)));
  return rows;
}

/**
 * What replaces the old static "Likelihood" line, which sat exactly where a buyer asks "will this
 * actually work?" and answered with a sentence about our methodology.
 *
 * Three things stand in its place, all of them already on the record: the kill condition (how we
 * would know we were wrong), the evidence the diagnosis rests on with the people who said it, and
 * the client's own figures beside the formula — explicitly not multiplied out.
 */
function likelihoodSection(engagement: Engagement, finding: ConstraintFinding): string {
  const evidence = finding.evidence ?? [];
  const speakers = [...new Set(evidence.map((item) => text(item.speaker)).filter(Boolean))];
  const rows = clientArithmetic(engagement, finding);
  const formula = text(finding.projectedDelta?.formula);
  const parts = [
    `We are not going to forecast a result for you. Three honest things stand in place of one invented one: how we would know we were wrong, what the diagnosis actually rests on, and your own figures with the arithmetic left in your hands.`,
    `### How we would know we were wrong`,
    text(finding.killCondition) ||
      `No kill condition has been written down yet. One is required before this proposal is signed — without it there is no way to tell a sprint that worked from one that did not.`,
    `### What this rests on`,
    evidence.length
      ? `${evidence.length} client-stated ${evidence.length === 1 ? "quote" : "quotes"} on the record${speakers.length ? `, from ${sentenceList(speakers)}` : ""}, each carrying a speaker and a timestamp. Every claim in this document traces back to one of them. Where we had no quote, we have said so rather than filled the gap.`
      : `No client-stated quote is on the record yet, so the diagnosis is not evidenced in your own words. That has to be fixed before this proposal is signed.`,
    `### Your numbers, your arithmetic — we project nothing`,
  ];
  if (rows.length) {
    parts.push(rows.map((row) => `- **${row.label}:** ${row.figure} — ${row.attribution}`).join("\n"));
    if (formula) parts.push(`The change this sprint is measured by: \`${formula}\`.`);
    parts.push(`Those are your figures, in your words, and the formula we will measure against. We have deliberately not multiplied them together for you: any number produced that way would be our projection wearing your numbers. The arithmetic is yours, and you are better placed to do it than we are.`);
  } else {
    parts.push(`You have not yet given us a figure we could stand behind, so there is nothing to lay out here. Nothing in this proposal is quantified until you confirm a starting number.`);
  }
  return parts.join("\n\n");
}

/**
 * The block that makes the document signable: when it was issued, how long it stands, what it
 * costs, what starts it, how it stops, and two places to sign.
 *
 * Every term is one the record already supports. There is no payment schedule, no deposit, no
 * notice period and no legal boilerplate here, because none of that exists anywhere in this
 * engagement and inventing it would be inventing a commitment.
 */
function acceptanceSection(
  engagement: Engagement,
  finding: ConstraintFinding,
  issuedAt: string,
): string {
  const issued = formatDocumentDate(issuedAt);
  const validUntil = formatDocumentDate(addDays(issuedAt, 30));
  const instrument = finding.baselineInstrumentation?.required
    ? ` The first task is then ${text(finding.baselineInstrumentation.firstSprintTask) || "instrumenting the starting measurement"}.`
    : "";
  const advisorParty = text(engagement.advisor) || "the advisor";
  return `## Acceptance

- **Date issued:** ${issued || "not dated"}
- **Valid until:** ${validUntil || "thirty days from issue"} — thirty days from issue. After that the scope and the fee are confirmed with you again, not assumed.
- **Fee:** ${PRICE_LABEL}, fixed, exactly as set out under Investment above.
- **Work starts when:** ${ownerLabel(finding.humanOwner)} accepts this proposal in writing.${instrument}
- **Stopping:** either side can stop the sprint at any Monday, in writing. There is no notice period and no commitment beyond the sprint described here.

Signing below means the constraint, the scope, the metric and the named owner above are agreed as written. Nothing outside this page is being agreed to.

| For ${engagement.client} | For ${advisorParty} |
| --- | --- |
| Signature: | Signature: |
| Name: ${ownerLabel(finding.humanOwner)} | Name: |
| Date: | Date: |`;
}

export function generateProposal(
  engagement: Engagement,
  finding: ConstraintFinding,
  options: { issuedAt?: string } = {},
): string {
  // Only the constraint-relevant figures reach a client-facing page. The unfiltered list carries
  // the age of their website and how long a former hire lasted, which reads as a transcript dump.
  const numbers = constraintRelevantNumbers(engagement, finding);
  const appendix = finding.appendixItems ?? [];
  const issuedAt = text(options.issuedAt).slice(0, 10) || new Date().toISOString().slice(0, 10);
  return `# ${engagement.client} — Fixed-Sprint Proposal

## The one constraint this sprint buys down

${clientConstraintHeadline(finding)}

${constraintStepLine(engagement, finding)}

## What you told us

${evidenceQuotes(finding)}

## Your numbers, as you stated them

${numbers.length ? numbers.join("\n") : "- None on record. Nothing in this proposal is quantified until you confirm a starting number."}

## Dream outcome

Move ${text(finding.baselineMetric?.name) || "the constraint metric"} in ${constraintBlock(finding)}.

${projectionBlock(finding)}

## Whether this will work

${likelihoodSection(engagement, finding)}

## Time

Fixed two-week sprint.

${measurementClockSentence(finding)}

## Effort

We build; ${ownerName(finding)} approves. No consequential action is taken without that approval.

## Scope

${text(finding.prescription?.description) || "Missing — no prescription has been recorded."}

Why this is the smallest intervention that moves the constraint: ${text(finding.prescription?.whySmallestIntervention) || "not yet argued."}

${finding.baselineInstrumentation?.required
  ? `First task in the sprint, before anything is built: ${text(finding.baselineInstrumentation.firstSprintTask) || "instrument the baseline."}`
  : "The baseline is already instrumented and reproducible."}

${investmentSection(finding)}

## Explicitly out of scope

${appendix.length
  ? appendix.map((item) => `- ${item}`).join("\n")
  : "- Nothing else has been deferred in writing yet."}

## Validation questions

- Is ${ownerLabel(finding.humanOwner)} accountable for this outcome?
- Is the starting metric confirmed and reproducible? Currently: ${metricLabel(finding)}
- Does the prescription act on the single current constraint in ${constraintBlock(finding)}?
- What would disprove the diagnosis? ${text(finding.killCondition) || "No kill condition has been recorded — one is required before signature."}

No ROI value is claimed without client-confirmed inputs.

${acceptanceSection(engagement, finding, issuedAt)}
`;
}

/* ------------------------------------------------------------------ *
 * Developer specification
 * ------------------------------------------------------------------ */

const SYSTEM_WORDS = /\b(software|systems?|integrations?|integrate\w*|automat\w+|apps?|application|tool|tools|tooling|databases?|api|apis|portal|dashboard|scripts?|webhooks?|crm|erp|platform|spreadsheet\s+macro)\b/i;

/**
 * A negated mention is not a mention. "hires nobody, buys no software, and changes no system" is
 * an argument that the prescription is *paper and people* — reading it as a system requirement is
 * exactly backwards, and it is how the practice engagement produced a developer spec for a
 * one-page price book.
 */
const NEGATED_SYSTEM = /\b(no|not|never|without|nothing|neither|nor)\b[^.;:]{0,40}?\b(software|systems?|integrations?|automat\w+|apps?|tool|tools|tooling|databases?|api|apis|platform)\b/gi;

/**
 * Whether the prescription actually asks somebody to build something.
 *
 * A third-party developer specification — autonomy boundaries, audit history, failure states — is
 * a real document when there is a system to build, and an embarrassment when the intervention is a
 * price book and a changed handoff. Only the prescription's own description and the sprint's tasks
 * are read: the "why this is the smallest intervention" argument routinely lists the systems the
 * change deliberately avoids.
 */
export function prescriptionImplicatesSystem(
  engagement: Engagement,
  finding: ConstraintFinding,
): boolean {
  const haystack = [
    text(finding.prescription?.description),
    ...(engagement.data.sprint?.tasks ?? []).map((task) => text(task?.task)),
  ].filter(Boolean).join(" ");
  if (!haystack) return false;
  return SYSTEM_WORDS.test(haystack.replace(NEGATED_SYSTEM, " "));
}

export function generateDeveloperSpec(engagement: Engagement, finding: ConstraintFinding): string {
  const step = constraintStep(engagement, finding);
  const metric = finding.baselineMetric;
  const numbers = clientStatedNumbers(engagement, finding);
  return `# ${engagement.client} — Third-Party Developer Specification

## Human owner

${finding.humanOwner.name || "Missing — implementation may not ship"}${finding.humanOwner.role ? ` (${finding.humanOwner.role})` : ""}

## The constraint being removed

**${finding.constraintType} constraint in ${constraintBlock(finding)}.**

${constraintStepLine(engagement, finding)}

Client evidence this is real:

${evidenceQuotes(finding)}

## Scope

Autonomy: drafts-for-review.

Implement only: ${text(finding.prescription?.description) || "Missing — no prescription has been recorded; do not start."}

${step
  ? `Touch only the "${text(step.name)}" step of the value flow (${text(step.actor) || "actor not named"} / ${text(step.system) || "system not named"}). Adjacent steps are out of scope.`
  : "The affected flow step is not yet identified. Confirm it with the advisor before writing code."}

## Guardrails / ceiling

- Never publish, send, approve, spend, or change a system of record without explicit human approval.
- Preserve every evidence source and decision event.
- Never convert Missing, Inferred, or Assumed evidence into Known.
- Stop and escalate when required input is absent or conflicting.
- ${finding.humanOwner.name || "The named owner"} is the only approver for this scope.

## Functional requirements

- Capture the starting and ending metric with source, owner, and time period.
- Present outputs for review before external action.
- Maintain an auditable change history and failure state.
- Instrument ${text(metric?.name) || "the constraint metric"} (unit: ${text(metric?.unit) || "unstated"}; period: ${text(metric?.period) || "unstated"}; source of record: ${text(metric?.source) || "a source the client can reproduce"}).
${finding.baselineInstrumentation?.required
  ? `- Ship the baseline instrumentation first: ${text(finding.baselineInstrumentation.firstSprintTask) || "instrument the baseline."}`
  : "- The baseline is already instrumented; do not re-derive it."}

## Inputs and outputs

- Inputs: approved diagnosis, source links, baseline metric, named owner.
- Outputs: reviewable intervention result, activity event, measurement record.
- Starting metric on record: ${metricLabel(finding)}
${numbers.length ? `- Client-stated figures to reconcile against:\n${numbers.map((line) => `  ${line.replace(/^- /, "- ")}`).join("\n")}` : "- No client-stated figures are on record; do not invent one."}

## Error and escalation behavior

Fail closed when the named owner, baseline, permission, or required source is missing.

Stop and escalate immediately if this holds: ${text(finding.killCondition) || "no kill condition recorded — treat any contradicting evidence as a stop."}

## Acceptance criteria

- Owner and scope are visible.
- Guardrails are enforced.
- Baseline is reproducible.
- Before-and-after result can be measured without invented inputs.
- The intervention acts on ${constraintBlock(finding)}${step ? ` at the "${text(step.name)}" step` : ""} and nowhere else.
`;
}

/* ------------------------------------------------------------------ *
 * Roadmap
 * ------------------------------------------------------------------ */

function sprintTaskLines(sprint: SprintRecord | undefined): string {
  const tasks = sprint?.tasks;
  if (!Array.isArray(tasks) || !tasks.length) return "";
  return tasks
    .map((task) => `   - [${task.status === "done" ? "done" : task.status === "in_progress" ? "in progress" : "todo"}] ${text(task.task) || "Untitled task"} — ${text(task.owner) || "owner not named"}`)
    .join("\n");
}

export function generateRoadmap(engagement: Engagement, finding: ConstraintFinding): string {
  const sprint = engagement.data.sprint;
  const outcome = engagement.data.outcome;
  const tasks = sprintTaskLines(sprint);
  const measured = outcome
    ? outcome.delta
      ? `Measured: ${outcome.delta.absolute} (${outcome.delta.percent}; the metric ${outcome.delta.direction}${outcome.delta.interpretation === "not-interpreted" ? ", interpretation not stated" : `, ${outcome.delta.interpretation}`}), measured ${text(outcome.measuredAt)} by ${text(outcome.measuredBy) || "an unrecorded party"}.`
      : `Measured on ${text(outcome.measuredAt) || "an unrecorded date"}: no delta is stated — ${text(outcome.deltaBlockedReason) || "the required confirmed readings are missing."}`
    : "Not yet measured.";
  return `# ${engagement.client} — Implementation Roadmap

1. Sprint 1: ${finding.prescription.description}
${tasks ? `${tasks}\n` : ""}2. Measure the before-and-after result for ${finding.baselineMetric.name || "the confirmed baseline metric"}.
   - ${measured}
3. Record where the bottleneck moved.
   - ${outcome ? (outcome.constraintMoved ? `Moved to: ${text(outcome.nextConstraintObserved) || "an unrecorded next constraint"}.` : "Not moved yet — the constraint remains where it was diagnosed.") : `Predicted next: ${finding.predictedNextConstraint}`}
4. Diagnose and remove the next constraint.

Governance is applied throughout: ${finding.humanOwner.name || "a named human owner is still required"} approves any consequential action.
`;
}

/* ------------------------------------------------------------------ *
 * Sprint, outcome, catalog
 * ------------------------------------------------------------------ */

export function generateSprintPlan(
  engagement: Engagement,
  finding: ConstraintFinding,
  sprint: SprintRecord,
): string {
  const tasks = Array.isArray(sprint?.tasks) ? sprint.tasks : [];
  const start = sprint?.startingMetric;
  const startLabel = text(start?.value)
    ? [text(start?.value), text(start?.unit), text(start?.period)].filter(Boolean).join(" ")
    : "Missing — the measurement clock cannot be trusted until this is captured.";
  return `# ${engagement.client} — Sprint Plan

## Sprint

- Sprint: ${text(sprint?.sprintId) || "unidentified"}
- Constraint: ${text(sprint?.constraintId) || text(finding.constraintId) || "unidentified"} — ${finding.constraintType} constraint in ${constraintBlock(finding)}
- Activated: ${text(sprint?.activatedAt) || "unrecorded"} by ${text(sprint?.activatedBy) || "an unrecorded party"}
- Human owner: ${ownerLabel(sprint?.humanOwner ?? finding.humanOwner)}

${constraintStepLine(engagement, finding)}

## Prescription

${text(sprint?.prescription) || text(finding.prescription?.description) || "Missing — no prescription has been recorded."}

Why this is the smallest intervention: ${text(finding.prescription?.whySmallestIntervention) || "not yet argued."}

## Starting metric

- ${text(start?.name) || text(finding.baselineMetric?.name) || "Unnamed metric"}: ${startLabel}
- Source: ${text(start?.source) || "unrecorded"}
- Measurement clock started: ${text(sprint?.measurementClockStartedAt) || "not started"}

No projected result is stated here. Only the measured ending metric will produce a number.

## Tasks

${tasks.length
  ? `| Status | Task | Owner |\n| --- | --- | --- |\n${tasks
      .map((task) => `| ${text(task.status) || "todo"} | ${text(task.task) || "Untitled task"} | ${text(task.owner) || "not named"} |`)
      .join("\n")}`
  : "- No tasks recorded. A sprint without written tasks is not activated."}

## Stop conditions

- ${text(finding.killCondition) || "No kill condition recorded — treat contradicting evidence as a stop."}
- Any consequential or external action pauses for ${ownerName(finding)}'s explicit approval.
- Fail closed when the owner, baseline, permission, or required source is missing.
`;
}

/**
 * A document that calls a change an improvement has to say on whose authority.
 * An advisor's declaration and a machine inference are not the same claim, and a
 * reader must be able to tell which one they are looking at.
 */
function directionBasis(outcome: OutcomeMeasurement): string {
  const inference = outcome?.directionInference;
  if (!inference?.improvedWhen) return "";
  const authority = inference.source === "advisor"
    ? "declared by the advisor"
    : `inferred from the metric (${inference.source}), not declared by the advisor`;
  const basis = text(inference.basis);
  return `\n- Basis: a ${inference.improvedWhen} number is the improvement — ${authority}.${basis ? `\n  ${basis}` : ""}`;
}

export function generateOutcomeReport(
  engagement: Engagement,
  finding: ConstraintFinding,
  outcome: OutcomeMeasurement,
): string {
  const format = (metric: OutcomeMeasurement["startingMetric"] | undefined): string => {
    const value = text(metric?.value);
    if (!value) return "Missing — not captured";
    return `${[value, text(metric?.unit), text(metric?.period)].filter(Boolean).join(" ")} (source: ${text(metric?.source) || "unrecorded"})`;
  };
  const evidence = Array.isArray(outcome?.evidence) ? outcome.evidence : [];
  return `# ${engagement.client} — Outcome Report

## What was measured

- Constraint: ${finding.constraintType} constraint in ${constraintBlock(finding)}
- Intervention: ${text(finding.prescription?.description) || "unrecorded"}
- Measured: ${text(outcome?.measuredAt) || "unrecorded"} by ${text(outcome?.measuredBy) || "an unrecorded party"}
- Owner: ${ownerLabel(finding.humanOwner)}

## Before and after

- Starting metric: ${format(outcome?.startingMetric)}
- Ending metric: ${format(outcome?.endingMetric)}

## Result

${outcome?.delta
  ? `- Change: ${text(outcome.delta.absolute) || "unrecorded"} (${text(outcome.delta.percent) || "unrecorded"})\n- Direction: the metric ${outcome.delta.direction}\n- Interpretation: ${outcome.delta.interpretation === "not-interpreted"
      ? "not stated. Whether this metric is better higher or lower was never declared, so this document does not call the change an improvement or a regression."
      : outcome.delta.interpretation}${directionBasis(outcome)}\n\nBoth readings above are client-confirmed. Nothing here is projected.`
  : `No result is claimed. ${text(outcome?.deltaBlockedReason) || "The two client-confirmed readings required to compute a change are not both present."}

No number, percentage, or direction of change may be reported, quoted, or reused until that is resolved.`}

## Where the constraint went

${outcome?.constraintMoved
  ? `The constraint moved. Next observed constraint: ${text(outcome.nextConstraintObserved) || "not yet named"}.`
  : `The constraint has not moved. It remains in ${constraintBlock(finding)}. Predicted next constraint remains: ${text(finding.predictedNextConstraint) || "unrecorded"}.`}

## Evidence

${evidence.length
  ? evidence.map((item) => `> “${text(item.quote)}”\n>\n> — ${text(item.source) || "source unrecorded"}`).join("\n\n")
  : "No supporting quote was captured for this measurement."}
`;
}

export function generateCatalogEntry(
  engagement: Engagement,
  finding: ConstraintFinding,
  entry: CatalogEntry,
): string {
  const block = canonicalCanvasBlock(entry?.canvasBlock) ?? text(entry?.canvasBlock) ?? constraintBlock(finding);
  return `# Catalog Entry — ${text(entry?.pattern) || "Unnamed pattern"}

- Entry: ${text(entry?.entryId) || "unidentified"}
- Written: ${text(entry?.writtenAt) || "unrecorded"}
- Constraint type: ${text(entry?.constraintType) || finding.constraintType}
- Canvas block: ${block}
- Source engagement: ${engagement.client}
- Industry context: ${text(entry?.industryContext) || "unrecorded"}

## Pattern

${text(entry?.pattern) || "Missing — the reusable pattern was not written down."}

## Prescription that was applied

${text(entry?.prescription) || text(finding.prescription?.description) || "unrecorded"}

## Measured result

${text(entry?.measuredResult) || "No measured result recorded. This entry may not be cited as evidence of an outcome."}

## Reusable for

${text(entry?.reusableFor) || "Not yet scoped. Do not apply this pattern elsewhere until the conditions are written down."}

## Reuse conditions

- Reuse this pattern only where the same constraint is diagnosed from client evidence, not by resemblance.
- The measured result above belongs to this engagement. It is never a projection for another client.
`;
}

/* ------------------------------------------------------------------ *
 * Roles & responsibility map
 * ------------------------------------------------------------------ */

/** Roles as captured by transcript synthesis. A person without a name is not a role. */
function roleEntries(engagement: Engagement): RoleMapEntry[] {
  const direct = Array.isArray(engagement.data.roles) ? engagement.data.roles : [];
  const fromCalls = synthesisRecords(engagement).flatMap((record) => record.roles ?? []);
  const seen = new Set<string>();
  const entries: RoleMapEntry[] = [];
  for (const role of [...direct, ...fromCalls]) {
    if (!role || typeof role !== "object") continue;
    const person = text(role.person);
    if (!person) continue;
    const key = person.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(role);
  }
  return entries;
}

/**
 * How the type of work is described in the document the owner may circulate to the people it
 * names. The stored enum is unchanged — `judgmentOrGrind` is still `judgment | grind | mixed`
 * everywhere in the record — but "grind" is not a word to print beside a named employee.
 */
const WORK_TYPE: Record<string, string> = {
  judgment: "judgment-led — decisions only they can make",
  grind: "repeatable — work that does not need their judgment",
  mixed: "mixed — some judgment, a lot of repetition",
};

function workType(role: RoleMapEntry): string {
  return WORK_TYPE[role.judgmentOrGrind] ?? "not recorded";
}

function bulletList(items: string[] | undefined, empty: string): string {
  const lines = (items ?? []).map((item) => text(item)).filter(Boolean);
  return lines.length ? lines.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

const ROLE_QUESTIONS = [
  "Walk me through one job. Who touches it, in order, by name?",
  "Who is accountable for that job landing well, even when someone else does the work?",
  "Who can approve a price, a scope change, or a spend — and who cannot?",
  "If one person were out for a week, which step would stop?",
  "Which part of their work needs their judgment, and which part is repetition anyone could take?",
];

function rolesMapEmpty(engagement: Engagement, finding: ConstraintFinding): string {
  return `# ${engagement.client} — Roles & Responsibility Map

## No role evidence was captured

The calls on record do not say who does what. Rather than draw an org chart from guesswork, this page stays empty: no name, reporting line, or approval right is asserted here.

Nothing below is a finding. It is the question set that turns this page into one.

## Ask these, in these words

${ROLE_QUESTIONS.map((question) => `- "${question}"`).join("\n")}

## Why it matters

The most common constraint we find is one person every job waits on — the one who prices, approves, or decides. It rarely shows up in an org chart, and it never shows up in public information. It only shows up when someone says it out loud on a call.

## Where this engagement stands

- Constraint of record: ${finding.constraintType} constraint in ${constraintBlock(finding)}.
- Named human owner: ${ownerLabel(finding.humanOwner)}.
- Role evidence: Missing. Until it is captured, this document may not be presented as a map of the business.
`;
}

/**
 * Who does the work, who owns the result, and where the flow waits on one person.
 * Single-point dependencies lead the document because they are usually the constraint.
 */
export function generateRolesMap(engagement: Engagement, finding: ConstraintFinding): string {
  const roles = roleEntries(engagement);
  if (!roles.length) return rolesMapEmpty(engagement, finding);

  const singlePoints = roles.filter((role) => role.singlePointDependency);
  const doers = roles.filter((role) => role.doesTask && !role.accountableForOutcome);
  const accountable = roles.filter((role) => role.accountableForOutcome && !role.doesTask);
  const both = roles.filter((role) => role.doesTask && role.accountableForOutcome);
  const approvers = roles.filter((role) => text(role.approvalAuthority));

  const dependencyBlock = singlePoints.length
    ? `${singlePoints
        .map((role) => {
          const tasks = (role.tasks ?? []).map((task) => text(task)).filter(Boolean);
          const detail = tasks.length ? ` Work that waits on them: ${tasks.join("; ")}.` : "";
          const approval = text(role.approvalAuthority) ? ` They also hold approval for ${text(role.approvalAuthority)}.` : "";
          return `**${text(role.person)} is a single point of dependency.**${detail}${approval}`;
        })
        .join("\n\n")}

Each person above is a place the whole flow can stop. If they are busy, away, or working on something else, the work behind them waits — no matter how much capacity anyone else has.`
    : `No single point of dependency was recorded on the calls. That is not the same as there being none. Confirm it directly: "if one person were out for a week, which step would stop?"`;

  const split = [
    doers.length
      ? `- Does the work, not accountable for the result: ${doers.map((role) => text(role.person)).join(", ")}.`
      : "- No one is recorded as doing the work without owning the result.",
    accountable.length
      ? `- Accountable for the result, does not do the work: ${accountable.map((role) => text(role.person)).join(", ")}.`
      : "- No one is recorded as owning a result someone else delivers.",
    both.length
      ? `- Both does the work and owns the result: ${both.map((role) => text(role.person)).join(", ")}. This is where a business is most often capped by one person's hours.`
      : "- No one is recorded as both doing the work and owning the result.",
  ].join("\n");

  const table = roles
    .map((role) =>
      `| ${text(role.person)} | ${text(role.reportsTo) || "not recorded"} | ${role.doesTask ? "yes" : "no"} | ${role.accountableForOutcome ? "yes" : "no"} | ${text(role.approvalAuthority) || "none recorded"} | ${workType(role)} | ${role.singlePointDependency ? "**yes**" : "no"} |`,
    )
    .join("\n");

  const detail = roles
    .map((role) =>
      `### ${text(role.person)}${role.singlePointDependency ? " — single point of dependency" : ""}

- Reports to: ${text(role.reportsTo) || "not recorded"}
- Does the task: ${role.doesTask ? "yes" : "no"} — Accountable for the outcome: ${role.accountableForOutcome ? "yes" : "no"}
- Approval authority: ${text(role.approvalAuthority) || "none recorded"}
- Type of work: ${workType(role)}

Responsibilities:

${bulletList(role.responsibilities, "None recorded on the calls.")}

Tasks:

${bulletList(role.tasks, "None recorded on the calls.")}`,
    )
    .join("\n\n");

  const ownerIsDependency = singlePoints.some(
    (role) => text(role.person).toLowerCase() === text(finding.humanOwner?.name).toLowerCase() && Boolean(text(finding.humanOwner?.name)),
  );

  return `# ${engagement.client} — Roles & Responsibility Map

Who does the work, who owns the result, and where everything waits on one person. Every name below was stated on a call; no role has been inferred.

## Read this first — single point of dependency

${dependencyBlock}

## The map

| Person | Reports to | Does the task | Accountable for outcome | Approval authority | Type of work | Single point |
| --- | --- | --- | --- | --- | --- | --- |
${table}

## Doing the work is not owning the result

${split}

## Who can approve

${approvers.length
  ? approvers.map((role) => `- ${text(role.person)}: ${text(role.approvalAuthority)}`).join("\n")
  : "- No approval authority was recorded. Ask who can say yes to a price, a scope change, or a spend — an unrecorded approver is a hidden queue."}

## Person by person

${detail}

## How this connects to the constraint

- Constraint of record: ${finding.constraintType} constraint in ${constraintBlock(finding)}.
- ${constraintStepLine(engagement, finding)}
- Named human owner of the intervention: ${ownerLabel(finding.humanOwner)}.
${ownerIsDependency
  ? `- The named owner is also a single point of dependency. Any intervention that adds work to them will not move the constraint — it moves the queue onto the person the queue is already on.`
  : `- No recorded single point of dependency is the named owner of the intervention.`}
`;
}

/* ------------------------------------------------------------------ *
 * Findings call agenda (Call 2)
 * ------------------------------------------------------------------ */

export interface FindingsAgendaQuote {
  quote: string;
  speaker: string;
  timestamp: string;
}

export interface FindingsAgendaSection {
  heading: string;
  body: string;
  evidence: FindingsAgendaQuote[];
}

/**
 * Only the client's own words, and only when they carry a speaker and a timestamp.
 * An advisor line, a research statement, or an unattributed paraphrase never reaches
 * this list — the agenda is read back to the client as their own evidence.
 */
function clientStatedQuotes(engagement: Engagement, finding: ConstraintFinding): FindingsAgendaQuote[] {
  const quotes: FindingsAgendaQuote[] = [];
  const seen = new Set<string>();
  const add = (quote: unknown, speaker: unknown, timestamp: unknown, provenance: unknown): void => {
    if (provenance !== "client-stated") return;
    const body = text(quote);
    const who = text(speaker);
    const when = text(timestamp);
    if (!body || !who || !when) return;
    const key = `${body}|${who}|${when}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    quotes.push({ quote: body, speaker: who, timestamp: when });
  };
  for (const item of finding.evidence ?? []) add(item.quote, item.speaker, item.timestamp, item.provenance);
  for (const record of synthesisRecords(engagement)) {
    for (const line of record.quotes ?? []) add(line.text, line.speaker, line.timestamp, line.provenance);
  }
  return quotes;
}

const PLAIN_CONSTRAINT: Record<string, string> = {
  capacity: "more work is arriving than this part of the business can get through",
  latency: "work sits waiting between steps, so a job takes far longer than the work itself does",
  quality: "work comes back to be redone, so the same job is paid for twice",
  knowledge: "what is needed to move a job lives in one person's head, so the job waits for that head",
  policy: "a rule or an approval holds the work back — not the people, and not the tools",
};

function plainConstraint(finding: ConstraintFinding): string {
  return PLAIN_CONSTRAINT[finding.constraintType] ?? "one step in the flow is limiting how much work gets finished";
}

function agendaHeardBody(engagement: Engagement, finding: ConstraintFinding, quoteCount: number): string {
  const symptoms = (finding.symptoms ?? [])
    .map((symptom) => {
      const statement = text(symptom.statement);
      if (!statement) return "";
      const number = text(symptom.number);
      return number ? `- ${statement} (${number})` : `- ${statement}`;
    })
    .filter(Boolean);
  // Only the figures the client said out loud, each still carrying its quote; the
  // symptom-derived numbers are advisor-recorded and already listed above.
  const numbers = constraintRelevantNumbers(engagement, finding).filter((line) => line.includes("“"));
  if (!symptoms.length && !numbers.length && !quoteCount) {
    return `We are not going to tell you what we heard, because nothing has been recorded in your words yet. No client-stated evidence exists on this engagement.

Before this can be a findings meeting, we need the call transcript and the quotes that came out of it. Until then, treat every line below as an open question rather than a conclusion.`;
  }
  const parts = [
    `Here is what you told us on the call, in the order it came up. Nothing here is our opinion — it is a summary of what was actually said.`,
  ];
  if (symptoms.length) parts.push(symptoms.join("\n"));
  if (numbers.length) parts.push(`Numbers you gave us:\n\n${numbers.join("\n")}`);
  else parts.push(`You did not give us a firm number for this, so nothing on the following pages is quantified.`);
  return parts.join("\n\n");
}

function agendaConstraintBody(engagement: Engagement, finding: ConstraintFinding): string {
  const step = constraintStep(engagement, finding);
  const where = step
    ? `Where it happens: **${text(step.name)}** — ${text(step.actor) || "the person doing it is not named yet"}${text(step.system) ? `, working in ${text(step.system)}` : ""}. Until that step clears, everything behind it waits.`
    : `We have not yet pinned this to one step of your process. That is the first thing to settle in this meeting.`;
  return `One thing is limiting how much work gets through: ${plainConstraint(finding)}.

${where}

We are naming one constraint, not a list. The other things we noticed are written down, but fixing them would not change what you get out the door this month.`;
}

function agendaProposalBody(finding: ConstraintFinding): string {
  const description = text(finding.prescription?.description);
  if (!description) {
    return `No intervention has been written down yet. We are not going to propose work we have not defined, so this page is deliberately empty until the diagnosis above is agreed.`;
  }
  const why = text(finding.prescription?.whySmallestIntervention);
  return `${description}

${why ? `Why this and nothing more: ${why}` : `We have not yet written down why this is the smallest change that would work. Ask us for that before you agree to it.`}

This is the smallest change we think moves the number. We are not proposing a rebuild, a new system across the business, or a change to how your team is structured.`;
}

function agendaEffortBody(engagement: Engagement, finding: ConstraintFinding): string {
  const owner = text(finding.humanOwner?.name);
  const ownerLine = owner
    ? `${ownerLabel(finding.humanOwner)} is the one person who approves the work. Nothing consequential happens without their yes.`
    : `No accountable person has been named yet. Nothing starts until one is — that is a condition of the sprint, not a preference.`;
  const instrument = finding.baselineInstrumentation?.required
    ? ` The first task, before anything is built, is ${text(finding.baselineInstrumentation.firstSprintTask) || "putting the starting measurement in place"}.`
    : "";
  const roles = roleEntries(engagement).filter((role) => role.singlePointDependency);
  const dependency = roles.length
    ? `\n\nOne caution in your own structure: ${roles.map((role) => text(role.person)).join(", ")} already ${roles.length > 1 ? "carry" : "carries"} work that nothing else can move past. The sprint is scoped not to add to that.`
    : "";
  return `A fixed two-week sprint at **${PRICE_LABEL}**, as a fixed fee agreed before anything starts.${instrument}

${ownerLine}

The fee covers the scope on the previous page, the review time of the person who approves it, and the before-and-after measurement. It does not cover ongoing running costs, or a second sprint on whatever the next constraint turns out to be.

We are not putting a return figure next to that price. Claiming one would mean inventing a starting number and a result, and we do not do that.${dependency}`;
}

function agendaMeasureBody(finding: ConstraintFinding): string {
  const metricName = text(finding.baselineMetric?.name) || "the number this constraint moves";
  if (!text(finding.baselineMetric?.value)) {
    return `We would measure ${metricName}.

You have not confirmed a starting number for it yet, so the first task of the sprint is to instrument it — to make it something you can look up and reproduce, not something either of us estimates.

Until that reading exists we will not quote an improvement, a percentage, or a return. At the end of the sprint you get two readings, taken the same way, and the difference between them.`;
  }
  return `We would measure ${metricName}.

- Starting reading: ${metricLabel(finding)}
- Source you can check it against: ${text(finding.baselineMetric?.source) || "not yet recorded — we would agree this before starting"}
- Measurement clock starts: ${text(finding.baselineInstrumentation?.measurementClockStartsWhen) || "when that reading is confirmed and reproducible"}

At the end of the sprint we take the same reading, the same way, and show you both. We are not forecasting the second number today.`;
}

function agendaSectionMarkdown(section: FindingsAgendaSection): string {
  const evidence = section.evidence
    .map((item) => `> “${item.quote}”\n>\n> — ${item.speaker}, ${item.timestamp}`)
    .join("\n\n");
  return `## ${section.heading}\n\n${section.body}${evidence ? `\n\n${evidence}` : ""}`;
}

/**
 * The Call 2 agenda. Returns the stored Markdown artifact and the same six sections
 * structured for one-per-screen presentation. No projected result appears in either.
 */
export function generateFindingsAgenda(
  engagement: Engagement,
  finding: ConstraintFinding,
): { markdown: string; sections: FindingsAgendaSection[] } {
  const quotes = clientStatedQuotes(engagement, finding);
  // The quotes attached to the finding itself — the ones that carry the diagnosis.
  const findingQuotes = clientStatedQuotes({ ...engagement, data: { ...engagement.data, transcriptSynthesis: [] } }, finding);

  const sections: FindingsAgendaSection[] = [
    {
      heading: "What we heard",
      body: agendaHeardBody(engagement, finding, quotes.length),
      evidence: [],
    },
    {
      heading: "The constraint",
      body: agendaConstraintBody(engagement, finding),
      evidence: findingQuotes.slice(0, 1),
    },
    {
      heading: "Your own words",
      body: quotes.length
        ? `Everything on the previous page came from these. They are yours, taken from the recording, not our summary of them. If any of it is wrong, this is the moment to say so.`
        : `We have no quote from you on record. That means the diagnosis is not yet evidenced in your words, and we are telling you that rather than paraphrasing you. Nothing in this pack should be treated as confirmed until this page has something on it.`,
      evidence: quotes,
    },
    {
      heading: "What we propose",
      body: agendaProposalBody(finding),
      evidence: [],
    },
    {
      heading: "What it would take",
      body: agendaEffortBody(engagement, finding),
      evidence: [],
    },
    {
      heading: "What we would measure",
      body: agendaMeasureBody(finding),
      evidence: [],
    },
  ];

  const markdown = `# ${engagement.client} — Findings

${quotes.length
  ? `Six pages, in order. Anything in quotation marks is your own words from the recorded call.`
  : `Six pages, in order. No client-stated quote has been captured yet, so this agenda names what is missing rather than filling the gap.`}

${sections.map(agendaSectionMarkdown).join("\n\n")}
`;

  return { markdown, sections };
}

/* ------------------------------------------------------------------ *
 * Printable HTML rendering (dependency-free)
 * ------------------------------------------------------------------ */

/**
 * All document text is escaped before any markdown transform runs, so generated content
 * (client quotes, source labels, URLs) can never inject markup into the printed page.
 */
function escapeHtml(value: string): string {
  return value
    // Drop control characters so the code-span placeholder below cannot be forged.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/|\.\/|\.\.\/)/i;

function inlineMarkdown(raw: string): string {
  const codes: string[] = [];
  let out = escapeHtml(raw).replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `<CODE${codes.length - 1}>`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) =>
    SAFE_HREF.test(href) ? `<a href="${href}" rel="noreferrer noopener">${label}</a>` : match,
  );
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return out.replace(/<CODE(\d+)>/g, (_match, index: string) => codes[Number(index)] ?? "");
}

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function alignment(cell: string): string {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return ' style="text-align:center"';
  if (right) return ' style="text-align:right"';
  return "";
}

function renderList(items: ListItem[], start: number, indent: number): { html: string; next: number } {
  const ordered = items[start].ordered;
  const rendered: string[] = [];
  let index = start;
  while (index < items.length && items[index].indent >= indent) {
    const item = items[index];
    if (item.indent > indent) {
      const child = renderList(items, index, item.indent);
      if (!rendered.length) rendered.push("");
      rendered[rendered.length - 1] += child.html;
      index = child.next;
      continue;
    }
    if (item.ordered !== ordered) break;
    rendered.push(inlineMarkdown(item.text));
    index += 1;
  }
  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${rendered.map((entry) => `<li>${entry}</li>`).join("")}</${tag}>`, next: index };
}

function renderBlocks(lines: string[]): string {
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence, or end of input
      const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : "";
      html.push(`<pre><code${language}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (RULE.test(line)) {
      html.push("<hr />");
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const quoted = QUOTE.exec(lines[i]);
        if (!quoted) break;
        body.push(quoted[1]);
        i += 1;
      }
      html.push(`<blockquote>${renderBlocks(body)}</blockquote>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = tableCells(line);
      const aligns = tableCells(lines[i + 1]).map(alignment);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(tableCells(lines[i]));
        i += 1;
      }
      const head = header.map((cell, index) => `<th${aligns[index] ?? ""}>${inlineMarkdown(cell)}</th>`).join("");
      const body = rows
        .map((row) => `<tr>${row.map((cell, index) => `<td${aligns[index] ?? ""}>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
        .join("");
      html.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const match = LIST_ITEM.exec(lines[i]);
        if (match) {
          items.push({ indent: match[1].length, ordered: !match[2], text: match[4] });
          i += 1;
          continue;
        }
        // A wrapped continuation line belongs to the item above it.
        if (items.length && lines[i].trim() && /^\s+/.test(lines[i]) && !HEADING.test(lines[i])) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      if (items.length) html.push(renderList(items, 0, items[0].indent).html);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const current = lines[i];
      if (HEADING.test(current) || RULE.test(current) || QUOTE.test(current) || FENCE.test(current) || LIST_ITEM.test(current)) break;
      paragraph.push(current.trim());
      i += 1;
    }
    if (paragraph.length) html.push(`<p>${paragraph.map(inlineMarkdown).join("<br />")}</p>`);
  }
  return html.join("\n");
}

const PRINT_STYLES = `:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2.5rem 1.5rem 4rem;
  background: #f6f6f4;
  color: #16181d;
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}
main {
  max-width: 46rem;
  margin: 0 auto;
  padding: 3rem 3.25rem 3.5rem;
  background: #fff;
  border: 1px solid #e2e2dd;
  border-radius: 4px;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2rem 0 0.75rem; font-weight: 650; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 1.9rem; margin-top: 0; letter-spacing: -0.01em; }
h2 { font-size: 1.35rem; padding-top: 1rem; border-top: 1px solid #ecece6; }
h3 { font-size: 1.08rem; }
h4, h5, h6 { font-size: 1rem; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1rem; }
ul, ol { padding-left: 1.4rem; }
li { margin: 0.3rem 0; }
li > ul, li > ol { margin: 0.3rem 0 0; }
a { color: #1d4ed8; overflow-wrap: anywhere; }
strong { font-weight: 650; }
code {
  font: 0.875em/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  background: #f1f1ee;
  border: 1px solid #e4e4de;
  border-radius: 3px;
  padding: 0.08em 0.32em;
}
pre {
  background: #f8f8f6;
  border: 1px solid #e4e4de;
  border-radius: 4px;
  padding: 0.9rem 1rem;
  overflow-x: auto;
}
pre code { background: none; border: 0; padding: 0; }
blockquote {
  margin-left: 0;
  padding: 0.25rem 0 0.25rem 1rem;
  border-left: 3px solid #c9c9c0;
  color: #3f4249;
}
blockquote p:last-child { margin-bottom: 0; }
hr { border: 0; border-top: 1px solid #e2e2dd; margin: 2rem 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.94rem; }
th, td { border: 1px solid #e2e2dd; padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
th { background: #f6f6f3; font-weight: 650; }
tr, img { break-inside: avoid; page-break-inside: avoid; }
@page { margin: 18mm; }
@media print {
  body { background: #fff; padding: 0; font-size: 11.5pt; }
  main { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; }
  a { color: inherit; text-decoration: underline; }
  h2 { border-top: 0; padding-top: 0; }
  pre, blockquote, table { break-inside: avoid; page-break-inside: avoid; }
}`;

/**
 * Render generated Markdown as one self-contained printable HTML document.
 * No external assets, fonts, scripts, or network requests: it prints or saves as PDF
 * straight from the browser.
 */
export function renderMarkdownToHtml(markdown: string, title: string): string {
  const source = typeof markdown === "string" ? markdown : "";
  const safeTitle = escapeHtml(text(title) || "Document");
  const body = renderBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${safeTitle}</title>
<style>
${PRINT_STYLES}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/**
 * Generated Markdown as readable plain text, for the text part of an email.
 *
 * A recipient whose client shows the text part sees exactly what we send it. Sending raw Markdown
 * means they read `## What the session is` and `**bold**` as literal characters, which is the
 * difference between a letter and a config file. Structure is preserved — headings stay on their
 * own line, list markers survive, a link keeps its address — only the syntax is removed.
 */
export function markdownToPlainText(markdown: string): string {
  const source = (typeof markdown === "string" ? markdown : "").replace(/\r\n?/g, "\n");
  const out: string[] = [];
  let inFence = false;
  for (const raw of source.split("\n")) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    if (RULE.test(raw)) {
      out.push("");
      continue;
    }
    // The dashes under a table header carry no words at all.
    if (TABLE_DIVIDER.test(raw) && raw.includes("-")) continue;
    const heading = HEADING.exec(raw);
    let line = heading ? heading[2].trim() : raw.replace(/^\s{0,3}>\s?/, "");
    line = line
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1$2")
      .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1$2")
      .replace(/~~([^~]+)~~/g, "$1");
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")
        .map((cell) => cell.trim()).filter(Boolean).join(" — ");
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The firm's identity on a page. Nothing here is evidence and nothing here is a secret — it is
 * the advisor's own name, their firm's name, one address line, the confidentiality sentence they
 * want at the foot of every page, and an optional logo held inline as a data URL.
 *
 * Every field is optional in practice: a document renders with graceful fallbacks when the advisor
 * has configured none of it, so an unconfigured account never prints a broken header.
 */
export interface LetterheadSettings {
  firmName: string;
  advisorName: string;
  /** One line, as it should print: street, city, postcode, or just a phone and an email. */
  addressLine: string;
  /** Printed at the foot of every page. Defaults to the standard confidentiality sentence. */
  footerLine: string;
  /** `data:image/png;base64,…` or `data:image/jpeg;base64,…`. Empty when no logo is set. */
  logoDataUrl: string;
}

/** The confidentiality sentence a new advisor starts with, and the fallback when theirs is blank. */
export const DEFAULT_FOOTER_LINE =
  "Confidential — not to be shared beyond the intended recipient.";

/** Decoded size ceiling for an uploaded logo. Big enough for a real mark, small enough to inline. */
export const MAX_LOGO_BYTES = 200 * 1024;

/** The only two image types Drive's HTML→Doc conversion reliably carries through. */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg"] as const;

const LOGO_DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/\r\n]+={0,2})$/;

/** Decoded byte length of a base64 payload, without allocating the decoded bytes. */
function base64Bytes(payload: string): number {
  const clean = payload.replace(/[\r\n]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * Check an uploaded logo before it is stored. Returns the value to store, or a message written
 * for the advisor rather than for a log file. An empty value is valid: it means "no logo".
 */
export function validateLogoDataUrl(
  input: unknown,
): { ok: true; dataUrl: string } | { ok: false; message: string } {
  const value = text(input);
  if (!value) return { ok: true, dataUrl: "" };
  if (!value.startsWith("data:")) {
    return { ok: false, message: "That logo could not be read. Upload a PNG or JPEG file." };
  }
  const match = LOGO_DATA_URL.exec(value);
  if (!match) {
    return {
      ok: false,
      message: "That file is not a PNG or JPEG. Save your logo as a .png or .jpg and upload that.",
    };
  }
  const bytes = base64Bytes(match[2]);
  if (bytes > MAX_LOGO_BYTES) {
    return {
      ok: false,
      message: `That logo is ${Math.round(bytes / 1024)} KB. The limit is ${Math.round(MAX_LOGO_BYTES / 1024)} KB — save a smaller copy and upload it again.`,
    };
  }
  return { ok: true, dataUrl: value.replace(/[\r\n]/g, "") };
}

/* ------------------------------------------------------------------ *
 * Standard deliverable shell (title block + body + footer)
 * ------------------------------------------------------------------ */

export interface DeliverableDocMeta {
  client: string;
  title: string;        // e.g. "Fixed-Sprint Proposal"
  advisor: string;      // the advisor's name
  date: string;         // caller passes an ISO or display date — do NOT call Date.now() here
  confidential?: boolean;
  kind?: string;        // artifact kind, optional, for a small label
  /** The firm's identity, as configured in Settings. Absent or empty renders a clean fallback. */
  letterhead?: LetterheadSettings | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A date a client reads, from an ISO timestamp, with no locale data and no timezone surprises:
 * `2026-07-29T…` becomes `29 July 2026`. Anything unparseable is returned as it arrived, because
 * a date we cannot read is still better shown than silently dropped.
 */
export function formatDocumentDate(value: string): string {
  const raw = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return raw;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return raw;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/** `2026-07-29` plus n days, as `YYYY-MM-DD`. Returns "" when the input is not a date. */
export function addDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  if (!match) return "";
  const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(at)) return "";
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

/** Empty-but-valid letterhead, so every render path can assume the five fields exist. */
function letterheadOf(meta: DeliverableDocMeta): LetterheadSettings {
  const source = meta.letterhead ?? null;
  const logo = text(source?.logoDataUrl);
  return {
    firmName: text(source?.firmName),
    advisorName: text(source?.advisorName),
    addressLine: text(source?.addressLine),
    footerLine: text(source?.footerLine) || DEFAULT_FOOTER_LINE,
    // A logo is only ever emitted from a value that still validates as PNG/JPEG base64.
    logoDataUrl: validateLogoDataUrl(logo).ok ? logo : "",
  };
}

/**
 * The byline: the advisor's name from the letterhead when they set one, otherwise whatever the
 * caller knew, followed by the firm. "Prepared by" never prints empty.
 */
function bylineName(meta: DeliverableDocMeta, letterhead: LetterheadSettings): string {
  const advisor = letterhead.advisorName || text(meta.advisor);
  const parts = [advisor, letterhead.firmName].filter(Boolean);
  return parts.length ? parts.join(", ") : "the advisor";
}

/**
 * Every metadata value is escaped before it is placed into HTML, so a client name, title,
 * or advisor name containing `<`, `&`, or a quote can never inject markup. These values are
 * built directly into HTML (not routed through the markdown renderer), so they are escaped
 * exactly once here.
 */
function metaField(value: unknown): string {
  return escapeHtml(text(value));
}

/**
 * Drop the artifact's own leading `# Client — Title` line. The shell prints the title itself, and
 * two H1s at the top of a client document reads as a mistake in a way nothing else on the page does.
 */
function bodyWithoutLeadingHeading(markdown: string): string[] {
  const lines = (typeof markdown === "string" ? markdown : "").replace(/\r\n?/g, "\n").split("\n");
  let at = 0;
  while (at < lines.length && !lines[at].trim()) at += 1;
  return at < lines.length && /^#\s+\S/.test(lines[at]) ? lines.slice(at + 1) : lines;
}

/** The <title> element text: "{client} — {title}", escaped, with sensible fallbacks. */
function deliverableWindowTitle(meta: DeliverableDocMeta): string {
  const label = [text(meta.client), text(meta.title)].filter(Boolean).join(" — ");
  return escapeHtml(label || text(meta.title) || "Document");
}

/**
 * The letterhead band: the firm's mark on the left, the firm's name and address right-aligned.
 *
 * It is a two-cell table on purpose. Drive's HTML→Doc conversion throws away almost all CSS but
 * keeps table structure and inline base64 images, so a table is the only layout that means the
 * same thing in the browser, in print, and in a converted Google Doc. The logo is width-capped at
 * 150px for the same reason: a modest inline image converts reliably, a full-width one does not.
 */
function letterheadBand(letterhead: LetterheadSettings): string {
  const logo = letterhead.logoDataUrl
    ? `<img alt="${escapeHtml(letterhead.firmName || "Firm logo")}" src="${escapeHtml(letterhead.logoDataUrl)}" width="150" />`
    : "";
  const firm = [
    letterhead.firmName ? `<strong>${escapeHtml(letterhead.firmName)}</strong>` : "",
    letterhead.addressLine ? escapeHtml(letterhead.addressLine) : "",
  ].filter(Boolean).join("<br />");
  // Nothing configured at all: no empty band, no stray rule — the document simply starts at its title.
  if (!logo && !firm) return "";
  return [
    `<table class="letterhead"><tbody><tr>`,
    `<td class="letterhead-mark">${logo}</td>`,
    `<td class="letterhead-firm" style="text-align:right">${firm}</td>`,
    `</tr></tbody></table>`,
  ].join("");
}

/**
 * The standard title block: the letterhead band, the document's own title, then one attribution
 * line — who it was prepared for, who prepared it, and when — and a rule. Real document structure
 * only, so the whole block survives Drive's HTML→Doc conversion without relying on any CSS.
 */
function deliverableTitleBlock(meta: DeliverableDocMeta): string {
  const letterhead = letterheadOf(meta);
  const client = metaField(meta.client) || "the client";
  const title = metaField(meta.title) || "Advisory Deliverable";
  const date = escapeHtml(formatDocumentDate(text(meta.date)));
  const kind = metaField(meta.kind);
  const attribution = [
    `Prepared for ${client}`,
    `Prepared by ${escapeHtml(bylineName(meta, letterhead))}`,
    date,
  ].filter(Boolean).join(" · ");
  const lines = [letterheadBand(letterhead), `<h1>${title}</h1>`].filter(Boolean);
  if (kind) lines.push(`<p class="doc-kind">${kind}</p>`);
  lines.push(`<p class="doc-attribution">${attribution}</p>`);
  lines.push("<hr />");
  return lines.join("\n");
}

/**
 * The standard footer: a rule, the authorship line, and the advisor's own confidentiality
 * sentence. Structural elements only, so it converts cleanly into a Google Doc; in the printable
 * view the same block is pinned so it repeats on every printed page.
 */
function deliverableFooter(meta: DeliverableDocMeta): string {
  const letterhead = letterheadOf(meta);
  const client = metaField(meta.client) || "the client";
  const authorship = `Prepared for ${client} by ${escapeHtml(bylineName(meta, letterhead))}.`;
  const confidentiality = meta.confidential === false ? "" : escapeHtml(letterhead.footerLine);
  return [
    "<hr />",
    `<div class="doc-footer">`,
    `<p>${authorship}</p>`,
    confidentiality ? `<p>${confidentiality}</p>` : "",
    `</div>`,
  ].filter(Boolean).join("\n");
}

/**
 * Everything that makes a printed page look like it came from a firm rather than out of a browser.
 * Appended after PRINT_STYLES so it overrides the app's screen defaults without editing them.
 *
 * The rules that matter when this hits paper: a 2cm page margin on every side; a print-safe stack
 * (serif body, sans headings — no webfont, no network request); headings that do not orphan at a
 * page break; table headers that repeat on a continuation page; and a footer that is pinned to the
 * bottom of every printed page rather than appearing once at the end of the document.
 */
const LETTERHEAD_STYLES = `body {
  font-family: Georgia, "Times New Roman", "Liberation Serif", Times, serif;
  color: #14161a;
}
h1, h2, h3, h4, h5, h6 {
  font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif;
  letter-spacing: -0.005em;
}
table.letterhead { width: 100%; border-collapse: collapse; margin: 0 0 1.75rem; font-size: 0.95rem; }
table.letterhead td { border: 0; padding: 0; vertical-align: middle; }
table.letterhead td.letterhead-mark { width: 150px; }
table.letterhead img { max-width: 150px; height: auto; display: block; }
table.letterhead td.letterhead-firm { line-height: 1.5; }
p.doc-kind { margin: 0 0 0.35rem; font-size: 0.9rem; letter-spacing: 0.06em; text-transform: uppercase; color: #5b6069; }
p.doc-attribution { margin: 0 0 1rem; color: #3f4249; font-size: 0.98rem; }
.doc-footer { color: #4a4e56; font-size: 0.85rem; }
.doc-footer p { margin: 0.15rem 0; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
h1, h2, h3, h4, h5, h6 { break-after: avoid-page; page-break-after: avoid; }
p, li, blockquote { orphans: 3; widows: 3; }
@page { margin: 20mm; }
@media print {
  body { padding: 0 0 22mm; font-size: 11pt; }
  table.letterhead { margin-bottom: 1.2rem; }
  /* Pinned, so the confidentiality line lands on every page and not only the last one. */
  .doc-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding-top: 3mm;
    border-top: 1px solid #d8d8d2;
    background: #fff;
  }
  .doc-footer + hr, hr + .doc-footer { break-before: avoid; }
  table { break-inside: auto; }
  tr, img { break-inside: avoid; page-break-inside: avoid; }
}`;

/**
 * A print-ready HTML document with the firm's letterhead, the standard title block and the
 * confidentiality footer, for the IN-APP printable view. Reuses the full renderer's markdown
 * conversion and keeps the complete print stylesheet, because this path is viewed and printed in a
 * browser — it is never handed to Drive, so its CSS is safe to rely on.
 */
export function renderDeliverableDocument(markdown: string, meta: DeliverableDocMeta): string {
  const body = renderBlocks(bodyWithoutLeadingHeading(markdown));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${deliverableWindowTitle(meta)}</title>
<style>
${PRINT_STYLES}
${LETTERHEAD_STYLES}
</style>
</head>
<body>
<main>
${deliverableTitleBlock(meta)}
${body}
${deliverableFooter(meta)}
</main>
</body>
</html>
`;
}

/**
 * A structural-only HTML document (title block + body + footer) whose formatting survives
 * Drive's HTML→Google-Doc conversion. Drive strips almost all CSS, so this path carries no
 * `<style>`/`@page` block and leans entirely on document STRUCTURE — headings, paragraphs,
 * bold, lists, tables, blockquote, hr — for everything load-bearing. The body uses the same
 * markdown→HTML conversion as the printable view, just without the heavy stylesheet.
 */
export function renderGoogleDocHtml(markdown: string, meta: DeliverableDocMeta): string {
  const body = renderBlocks(bodyWithoutLeadingHeading(markdown));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${deliverableWindowTitle(meta)}</title>
</head>
<body>
${deliverableTitleBlock(meta)}
${body}
${deliverableFooter(meta)}
</body>
</html>
`;
}
