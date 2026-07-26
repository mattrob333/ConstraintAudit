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
  for (const record of synthesisRecords(engagement)) {
    for (const metric of record.metrics ?? []) {
      const value = [text(metric.value), text(metric.unit), text(metric.period)].filter(Boolean).join(" ");
      if (!value) continue;
      lines.push(`- ${text(metric.label) || "Metric"}: ${value} — “${text(metric.quote)}” (${text(metric.speaker)}, ${text(metric.timestamp)})`);
    }
  }
  return lines;
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
      : outcome.delta.interpretation}\n\nBoth readings above are client-confirmed. Nothing here is projected.`
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
