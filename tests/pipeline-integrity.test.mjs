import assert from "node:assert/strict";
import test from "node:test";

import { demoModelPayload, demoSpeakerRoles, demoTranscript } from "../lib/demo.ts";
import {
  dimensionMatchesConstraint,
  findingStatusFor,
  groundModelSynthesis,
  metricCanConfirmBaseline,
  pathDisagreementBetween,
  selectBaselineMetric,
} from "../lib/openai-transcript-schema.ts";
import { baselineStatusFor, extractMetrics, parseTranscriptText, synthesizeTranscript } from "../lib/transcript.ts";

/**
 * The three exploits demonstrated by the 2026-07-29 adversarial audit (F1, F3, F4, F5), each
 * reproduced on the input that carried it and asserted to fail now. Every fabrication below is
 * built out of *real* client lines — that is the whole point of the findings: nothing here is
 * caught by checking whether the words were said.
 */

const call2Lines = () => parseTranscriptText(demoTranscript(2), demoSpeakerRoles());

/* ------------------------------------------------------------------ F1 */

// The exact line the audit ran its probe against.
const ROSA = "[04:43] Rosa Alvarez: I pulled the log in January because the Brightwater estimator was complaining. It is more like 9 days per quote. That is the average from the day I log it to the day it goes out.";
const WIN_RATE = "[06:53] Rosa Alvarez: I track it in the spreadsheet. We are winning about 20 percent of what we quote.";
const rosaLines = () => parseTranscriptText(ROSA, { "Rosa Alvarez": "client" });

test("a fabricated unit and period cannot confirm a baseline, even with the right digits", () => {
  // Audit F1, row 1: the model relabels "9 days per quote" as nine quotes won per month.
  const fabricated = groundModelSynthesis(
    {
      metrics: [{
        line: 1,
        quote: "It is more like 9 days per quote.",
        label: "Quotes won per month",
        value: "9",
        unit: "quotes",
        period: "month",
        // The closest real spans available. Neither carries what the model claimed.
        unit_span: "quote",
        period_span: "month",
        denominator_span: "",
      }],
    },
    rosaLines(), [], {},
  );
  assert.equal(fabricated.metrics.length, 1, "the client really did say 9, so the number stays as evidence");
  const metric = fabricated.metrics[0];
  assert.equal(metric.grounding, "partial", "a unit the client never said cannot be fully grounded");
  assert.equal(metric.unit, "", "an ungrounded unit is dropped, not carried on the metric");
  assert.equal(metric.period, "", "'month' is nowhere in that line");
  assert.equal(baselineStatusFor(fabricated.metrics), "Partial", "a partial metric must never confirm a baseline");
  assert.equal(metricCanConfirmBaseline(metric), false);
  assert.ok(
    fabricated.rejections.some((item) => item.kind === "metric.grounding"),
    "the downgrade is recorded, not silent",
  );

  // The honest reading of the same line still passes, unchanged.
  const honest = groundModelSynthesis(
    {
      metrics: [{
        line: 1,
        quote: "It is more like 9 days per quote.",
        label: "Quote turnaround time",
        value: "9",
        unit: "days",
        period: "per quote",
        unit_span: "days",
        period_span: "per quote",
        denominator_span: "",
      }],
    },
    rosaLines(), [], {},
  );
  assert.equal(honest.metrics[0].grounding, "full");
  assert.equal(baselineStatusFor(honest.metrics), "Confirmed", "grounding must not block a true metric");
});

test("a percentage with no client-stated denominator is not a confirmed baseline", () => {
  // Audit F1, row 2: "winning about 20 percent" relabelled as a rework rate per job.
  const lines = parseTranscriptText(WIN_RATE, { "Rosa Alvarez": "client" });
  const grounded = groundModelSynthesis(
    {
      metrics: [{
        line: 1,
        quote: "We are winning about 20 percent of what we quote.",
        label: "Rework rate",
        value: "20",
        unit: "percent",
        period: "job",
        unit_span: "percent",
        period_span: "",
        denominator_span: "",
      }],
    },
    lines, [], {},
  );
  assert.equal(grounded.metrics[0].grounding, "partial");
  assert.equal(grounded.metrics[0].period, "", "'per job' was never said");
  assert.equal(baselineStatusFor(grounded.metrics), "Partial");

  // The deterministic pass reaches the same verdict on the same line, and for the same reason:
  // it cannot name what the 20 percent is out of, so it does not pretend to.
  const extracted = extractMetrics(lines);
  assert.equal(extracted[0].value, "20%");
  assert.equal(extracted[0].grounding, "partial", "a rate with no denominator is not a measurement");
  assert.equal(baselineStatusFor(extracted), "Partial");
});

test("the deterministic pass names a metric from the line instead of a placeholder", () => {
  const metrics = extractMetrics(rosaLines());
  const turnaround = metrics.find((metric) => metric.value === "9 days");
  assert.ok(turnaround, "the log figure is still extracted");
  assert.equal(turnaround.label, "Days per quote");
  assert.equal(turnaround.grounding, "full");
  for (const metric of metrics) {
    assert.doesNotMatch(metric.label, /Client-stated \w* ?metric/, "the placeholder name is gone");
  }
  // ...and a placeholder name, wherever it came from, cannot anchor a baseline.
  assert.equal(
    baselineStatusFor([{ ...turnaround, label: "Client-stated day metric" }]),
    "Partial",
    "a generated stand-in is not the name of a business measure",
  );
});

/* ------------------------------------------------------------------ F4 */

test("the baseline must measure the constraint, not merely be the first number with a period", () => {
  // The audit's demonstration: the real call-1 transcript read deterministically produced a
  // latency constraint with a Confirmed baseline of "30 requests / month".
  const synthesis = synthesizeTranscript(demoTranscript(1), {
    client: "Meridian Millwork",
    callNumber: 1,
    speakerRoles: demoSpeakerRoles(),
  });
  assert.equal(synthesis.constraintCandidate.constraintType, "latency");
  const baseline = synthesis.constraintCandidate.baselineMetric;
  assert.doesNotMatch(baseline.value, /request/i, "monthly enquiry volume cannot be a latency baseline");
  assert.equal(baseline.unit, "days", "a latency constraint is measured in time");
  assert.match(baseline.value, /^9 days$/);

  // The mapping itself, stated directly.
  assert.equal(dimensionMatchesConstraint("latency", "requests", "month"), false);
  assert.equal(dimensionMatchesConstraint("latency", "days", "quote"), true);
  assert.equal(dimensionMatchesConstraint("capacity", "requests", "month"), true);
  assert.equal(dimensionMatchesConstraint("capacity", "days", "quote"), false);
  assert.equal(dimensionMatchesConstraint("quality", "percent", "month"), true);
  // Knowledge and policy have no single dimension, but still need a real one.
  assert.equal(dimensionMatchesConstraint("knowledge", "days", "quote"), true);
  assert.equal(dimensionMatchesConstraint("knowledge", "", ""), false);
});

test("no metric of the constraint's dimension means Missing, never a substitute", () => {
  const synthesis = synthesizeTranscript(
    "[00:10] Morgan: We handle 20 bids each week.\n[00:30] Morgan: Approval takes 3 days and the queue waits for me.",
    { client: "Acme", callNumber: 2, humanOwner: { name: "Morgan", role: "Owner" }, speakerRoles: { Morgan: "client" } },
  );
  assert.equal(synthesis.constraintCandidate.constraintType, "latency");
  // "3 days" has no period, so it is partial; "20 bids per week" is fully grounded but counts
  // throughput, not elapsed time. Neither can be the baseline for a latency constraint.
  assert.equal(synthesis.constraintCandidate.baselineMetric.source, "Missing");
  assert.equal(synthesis.constraintCandidate.baselineMetric.value, "");
  assert.equal(
    synthesis.constraintCandidate.findingStatus,
    "provisional",
    "a finding with no baseline for its own constraint cannot be client-verified",
  );
  assert.equal(selectBaselineMetric(synthesis.metrics, "capacity").value, "20 bids", "the same metric does fit capacity");
});

test("the model's baseline nomination is validated against the constraint, never reassigned", () => {
  const lines = call2Lines();
  const payload = demoModelPayload();
  // The honest payload binds cleanly.
  const honest = groundModelSynthesis(payload, lines, [], {});
  assert.equal(honest.constraint.baselineMetricIndex, 0);
  assert.equal(honest.constraint.baselineMetric.value, "9");
  assert.ok(honest.constraint.baselineReason.trim());

  // Nominate a metric that is not fully grounded and nothing takes its place.
  const weakened = demoModelPayload();
  weakened.metrics[0].period_span = "";
  const rejected = groundModelSynthesis(weakened, lines, [], {});
  assert.equal(rejected.constraint.baselineMetricIndex, -1);
  assert.equal(rejected.constraint.baselineMetric, null, "the baseline is Missing, not the next best number");
  assert.ok(rejected.gaps.some((gap) => /baseline/i.test(gap)), "and the advisor is told why");

  // A knowledge constraint additionally has to justify its baseline in writing.
  const unjustified = demoModelPayload();
  unjustified.constraint.baseline_reason = "";
  const unbound = groundModelSynthesis(unjustified, lines, [], {});
  assert.equal(unbound.constraint.baselineMetric, null);
  assert.ok(unbound.rejections.some((item) => item.reason === "baseline-reason-required"));
});

/* ------------------------------------------------------------------ F3 */

test("a citation that names a line but no words is rejected", () => {
  const lines = call2Lines();
  const payload = demoModelPayload();
  payload.constraint.evidence = payload.constraint.evidence.map((item) => ({ ...item, quote: "" }));
  const grounded = groundModelSynthesis(payload, lines, [], {});
  assert.equal(grounded.constraint, null, "a constraint assembled from bare line numbers must not ship");
  assert.ok(
    grounded.rejections.some((item) => item.reason === "citation-has-no-quote-span"),
    "the auto-grounding branch is gone",
  );
});

test("a constraint with no mechanism citation is rejected and the gap says why", () => {
  const lines = call2Lines();
  const payload = demoModelPayload();
  // Every line is real and every quote is verbatim; only the reading is missing.
  payload.constraint.evidence = payload.constraint.evidence
    .filter((item) => item.role !== "mechanism")
    .map((item) => ({ ...item, role: "symptom" }));
  const grounded = groundModelSynthesis(payload, lines, [], {});
  assert.equal(grounded.constraint, null);
  assert.ok(grounded.rejections.some((item) => item.reason === "no-mechanism-citation"));
  assert.ok(
    grounded.gaps.some((gap) => /mechanism/i.test(gap)),
    "a rejected constraint explains itself rather than vanishing",
  );
});

test("a constraint needs two distinct client lines, and a real role on each", () => {
  const lines = call2Lines();

  const oneLine = demoModelPayload();
  const mechanism = oneLine.constraint.evidence.find((item) => item.role === "mechanism");
  // The same line cited twice is one line, not corroboration.
  oneLine.constraint.evidence = [mechanism, { ...mechanism }];
  const thin = groundModelSynthesis(oneLine, lines, [], {});
  assert.equal(thin.constraint, null);
  assert.ok(thin.rejections.some((item) => item.reason === "fewer-than-two-grounded-client-lines"));

  const unroled = demoModelPayload();
  unroled.constraint.evidence = unroled.constraint.evidence.map((item) => ({ ...item, role: "" }));
  const untagged = groundModelSynthesis(unroled, lines, [], {});
  assert.equal(untagged.constraint, null);
  assert.ok(untagged.rejections.some((item) => item.reason === "unknown-evidence-role"));
});

test("rejected rivals are grounded like any citation and become the appendix", () => {
  const lines = call2Lines();
  const grounded = groundModelSynthesis(demoModelPayload(), lines, [], {});
  assert.equal(grounded.rejectedHypotheses.length, 2);
  assert.deepEqual(
    grounded.rejectedHypotheses.map((item) => item.constraintType).sort(),
    ["capacity", "policy"],
    "price and capacity are the rivals this call actually argues about",
  );
  for (const rival of grounded.rejectedHypotheses) {
    assert.ok(rival.quote.trim() && rival.speaker.trim() && rival.timestamp.trim());
    assert.ok(rival.line > 0);
  }

  // An invented rival is discarded rather than printed.
  const invented = demoModelPayload();
  invented.rejected_hypotheses = [{
    constraint_type: "quality",
    canvas_block: "Value Propositions",
    reason: "Rework was ruled out.",
    line: 1,
    quote: "We redo about a third of every job before it ships.",
  }];
  const cleaned = groundModelSynthesis(invented, lines, [], {});
  assert.deepEqual(cleaned.rejectedHypotheses, [], "a rival with no real client line behind it is dropped");
});

test("the deterministic appendix is no longer structurally empty", () => {
  const synthesis = synthesizeTranscript(demoTranscript(1), {
    client: "Meridian Millwork",
    callNumber: 1,
    speakerRoles: demoSpeakerRoles(),
  });
  const appendix = synthesis.constraintCandidate.appendixItems;
  assert.ok(appendix.length >= 1, "the readings this pass considered and did not take are the appendix");
  for (const item of appendix) {
    assert.match(item, /^Not the constraint — /);
    assert.match(item, /Strongest client line for it/);
  }
  assert.equal(
    appendix.some((item) => item.includes(synthesis.constraintCandidate.constraintType + " (")),
    false,
    "the chosen constraint is not listed as a rival to itself",
  );
});

/* ------------------------------------------------------------------ F5 */

test("model and deterministic disagreement forces the finding provisional", () => {
  const deterministic = { constraintType: "latency", canvasBlock: "Key Activities" };
  const model = { constraintType: "knowledge", canvasBlock: "Key Resources" };

  const disagreement = pathDisagreementBetween(deterministic, model);
  assert.ok(disagreement, "the disagreement is a structured record, not only a gap sentence");
  assert.deepEqual(disagreement.fields, ["constraintType", "canvasBlock"]);
  assert.equal(disagreement.model.constraintType, "knowledge");
  assert.equal(disagreement.deterministic.constraintType, "latency");

  const baselineMetric = extractMetrics(rosaLines()).find((metric) => metric.grounding === "full");
  assert.ok(baselineMetric);
  const settled = {
    baselineStatus: "Confirmed",
    baselineMetric,
    callNumber: 2,
    priorConflict: false,
    pathDisagreement: null,
  };
  // Everything else identical: only the disagreement moves the answer.
  assert.equal(findingStatusFor(settled), "client-verified");
  assert.equal(
    findingStatusFor({ ...settled, pathDisagreement: disagreement }),
    "provisional",
    "two readings of one transcript cannot be sold as a verified finding",
  );

  // A block-only disagreement counts too — same constraint, different part of the business.
  assert.equal(
    findingStatusFor({
      ...settled,
      pathDisagreement: pathDisagreementBetween(deterministic, {
        constraintType: "latency",
        canvasBlock: "Key Resources",
      }),
    }),
    "provisional",
  );
  assert.equal(pathDisagreementBetween(deterministic, deterministic), null, "agreement is not a disagreement");
});

test("verification still requires a bound baseline and the second call", () => {
  const baselineMetric = extractMetrics(rosaLines()).find((metric) => metric.grounding === "full");
  const base = {
    baselineStatus: "Confirmed",
    baselineMetric,
    callNumber: 2,
    priorConflict: false,
    pathDisagreement: null,
  };
  assert.equal(findingStatusFor(base), "client-verified");
  assert.equal(findingStatusFor({ ...base, baselineMetric: null }), "provisional");
  assert.equal(findingStatusFor({ ...base, baselineStatus: "Partial" }), "provisional");
  assert.equal(findingStatusFor({ ...base, callNumber: 1 }), "provisional");
  assert.equal(findingStatusFor({ ...base, priorConflict: true }), "provisional");
});

/* ------------------------------------------------- the practice engagement */

test("the practice transcript still survives its own grounding, unchanged", () => {
  const grounded = groundModelSynthesis(demoModelPayload(), call2Lines(), [], {});
  assert.deepEqual(grounded.rejections, [], "the shipped worked example must not fail its own gates");
  assert.deepEqual(grounded.gaps, []);
  assert.equal(grounded.constraint.constraintType, "knowledge");
  assert.equal(grounded.constraint.canvasBlock, "Key Resources");
  assert.equal(grounded.constraint.baselineMetric.value, "9");
  assert.equal(grounded.metrics[0].grounding, "full");
});
