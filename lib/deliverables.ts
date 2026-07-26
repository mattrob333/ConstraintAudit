import { mergeCanvas, type Canvas } from "./canvas";
import {
  CANVAS_BLOCKS,
  canonicalCanvasBlock,
  type CatalogEntry,
  type ConstraintFinding,
  type Engagement,
  type EvidenceClaim,
  type OutcomeMeasurement,
  type Provenance,
  type RoleMapEntry,
  type SprintRecord,
  type TranscriptSynthesis,
  type ValueFlowStep,
} from "./workflow";

export function generateReadinessBrief(
  engagement: Engagement,
  logistics: { videoLink?: string; duration?: string } = {},
): string {
  return `# ${engagement.client} — Pre-Call Readiness Brief

## What the session is

We'll walk through a map of your business we've drafted from public information. You correct it. Expect specific questions about how work actually flows.

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

**${finding.constraintType} constraint in ${constraintBlock(finding)}.**

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

/** Only numbers the client actually said, each still carrying its quote. */
function clientStatedNumbers(engagement: Engagement, finding: ConstraintFinding): string[] {
  const lines: string[] = [];
  for (const symptom of finding.symptoms ?? []) {
    const number = text(symptom.number);
    if (number) lines.push(`- ${number} — ${text(symptom.statement) || "symptom recorded without a statement"}`);
  }
  // `metric.value` already carries its unit ("3 days"), so appending unit and period blindly
  // produced "four years years". Only add a part the value does not already contain, and drop
  // the generated label entirely — "Client-stated year metric" is not language to read to a client.
  const seen = new Set<string>();
  for (const record of synthesisRecords(engagement)) {
    for (const metric of record.metrics ?? []) {
      const value = text(metric.value);
      if (!value) continue;
      const lower = value.toLowerCase();
      const measure = [value, ...[text(metric.unit), text(metric.period)]
        .filter((part) => part && !lower.includes(part.toLowerCase()))].join(" ");
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

export function generateProposal(engagement: Engagement, finding: ConstraintFinding): string {
  const numbers = clientStatedNumbers(engagement, finding);
  const appendix = finding.appendixItems ?? [];
  return `# ${engagement.client} — Fixed-Sprint Proposal

## The one constraint this sprint buys down

**${finding.constraintType} constraint in ${constraintBlock(finding)}.**

${constraintStepLine(engagement, finding)}

## What you told us

${evidenceQuotes(finding)}

## Your numbers, as you stated them

${numbers.length ? numbers.join("\n") : "- None on record. Nothing in this proposal is quantified until you confirm a starting number."}

## Dream outcome

Move ${text(finding.baselineMetric?.name) || "the constraint metric"} in ${constraintBlock(finding)}.

${projectionBlock(finding)}

## Likelihood

Grounded only in the client-stated evidence listed in the approved diagnosis and measured results from prior engagements when linked.

## Time

Fixed two-week sprint. The measurement clock starts when ${text(finding.baselineInstrumentation?.measurementClockStartsWhen) || "the starting metric is confirmed and reproducible"}.

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
`;
}

/* ------------------------------------------------------------------ *
 * Developer specification
 * ------------------------------------------------------------------ */

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

const WORK_TYPE: Record<string, string> = {
  judgment: "judgment — decisions only they can make",
  grind: "grind — repetitive work that does not need their judgment",
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
