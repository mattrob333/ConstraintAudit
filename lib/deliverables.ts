import type { ConstraintFinding, Engagement } from "./workflow";

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

**${finding.constraintType} constraint in ${finding.canvasBlock}.**

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

export function generateAuditReport(engagement: Engagement, finding: ConstraintFinding): string {
  const canvas = engagement.data.canvas ?? {};
  const blocks = [
    "Customer Segments", "Value Propositions", "Channels", "Customer Relationships",
    "Revenue Streams", "Key Resources", "Key Activities", "Key Partnerships", "Cost Structure",
  ];
  return `# ${engagement.client} — Throughput Audit Report

${blocks.map((block) => {
  const claims = canvas[block] ?? [];
  return `## ${block}\n\n${claims.length
    ? claims.map((claim) => `- ${claim.statement} _(${claim.provenance}; ${Math.round(claim.confidence * 100)}% confidence)_`).join("\n")
    : "- Missing — confirm with client evidence."}`;
}).join("\n\n")}

${generateDiagnosisPackage(engagement, finding)}
`;
}

export function generateProposal(engagement: Engagement, finding: ConstraintFinding): string {
  return `# ${engagement.client} — Fixed-Sprint Proposal

## Dream outcome

Improve the named constraint metric using: \`${finding.projectedDelta.formula}\`.

## Likelihood

Grounded only in the client-stated evidence listed in the approved diagnosis and measured results from prior engagements when linked.

## Time

Fixed two-week sprint.

## Effort

We build; your person approves.

## Scope

${finding.prescription.description}

## Validation questions

- Is ${finding.humanOwner.name || "the named owner"} accountable for this outcome?
- Is the starting metric confirmed and reproducible?
- Does the prescription act on the single current constraint?
- What would disprove the diagnosis? ${finding.killCondition}

No ROI value is claimed without client-confirmed inputs.
`;
}

export function generateDeveloperSpec(engagement: Engagement, finding: ConstraintFinding): string {
  return `# ${engagement.client} — Third-Party Developer Specification

## Human owner

${finding.humanOwner.name || "Missing — implementation may not ship"}${finding.humanOwner.role ? ` (${finding.humanOwner.role})` : ""}

## Scope

Autonomy: drafts-for-review.

Implement only: ${finding.prescription.description}

## Guardrails / ceiling

- Never publish, send, approve, spend, or change a system of record without explicit human approval.
- Preserve every evidence source and decision event.
- Never convert Missing, Inferred, or Assumed evidence into Known.
- Stop and escalate when required input is absent or conflicting.

## Functional requirements

- Capture the starting and ending metric with source, owner, and time period.
- Present outputs for review before external action.
- Maintain an auditable change history and failure state.

## Inputs and outputs

- Inputs: approved diagnosis, source links, baseline metric, named owner.
- Outputs: reviewable intervention result, activity event, measurement record.

## Error and escalation behavior

Fail closed when the named owner, baseline, permission, or required source is missing.

## Acceptance criteria

- Owner and scope are visible.
- Guardrails are enforced.
- Baseline is reproducible.
- Before-and-after result can be measured without invented inputs.
`;
}

export function generateRoadmap(engagement: Engagement, finding: ConstraintFinding): string {
  return `# ${engagement.client} — Implementation Roadmap

1. Sprint 1: ${finding.prescription.description}
2. Measure the before-and-after result for ${finding.baselineMetric.name || "the confirmed baseline metric"}.
3. Record where the bottleneck moved.
4. Diagnose and remove the next constraint.

Governance is applied throughout: ${finding.humanOwner.name || "a named human owner is still required"} approves any consequential action.
`;
}
