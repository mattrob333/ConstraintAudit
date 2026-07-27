import assert from "node:assert/strict";
import test from "node:test";

import { inferMetricDirection } from "../lib/metric-direction.ts";
import { groundModelSynthesis } from "../lib/openai-transcript-schema.ts";
import { parseTranscriptText } from "../lib/transcript.ts";
import { computeMetricDelta } from "../lib/workflow.ts";

const metric = (name, unit, period = "per month") => ({
  name,
  value: "1",
  unit,
  period,
  source: "client",
});

test("metric direction is inferred for the cases where the answer is obvious", () => {
  const cases = [
    ["estimate turnaround time", "days", "per estimate", "lower"],
    ["bids", "bids", "per week", "higher"],
    ["rework rate", "%", "per month", "lower"],
    ["on-time delivery", "%", "per month", "higher"],
    ["cost per job", "$", "per job", "lower"],
    ["revenue per job", "$", "per job", "higher"],
    ["errors", "errors", "per week", "lower"],
    ["queue size", "jobs", "per day", "lower"],
    ["monthly recurring revenue", "$", "per month", "higher"],
  ];
  for (const [name, unit, period, expected] of cases) {
    const result = inferMetricDirection(metric(name, unit, period));
    assert.equal(
      result.improvedWhen,
      expected,
      `"${name}" in ${unit} ${period} should be ${expected}-is-better, got ${result.improvedWhen} (${result.basis})`,
    );
    assert.ok(result.basis.trim(), "an inference must always explain itself");
    assert.notEqual(result.source, "advisor", "nothing here was advisor-declared");
  }
});

test("the advisor always outranks the inference", () => {
  // "days" reads as lower-is-better, but the advisor's word is final.
  const result = inferMetricDirection(metric("estimate turnaround time", "days", "per estimate"), {
    advisorDeclared: "higher",
  });
  assert.equal(result.improvedWhen, "higher");
  assert.equal(result.source, "advisor");
  assert.equal(result.confidence, 1);
});

test("an unreadable metric asks rather than guesses", () => {
  const empty = inferMetricDirection(metric("", "", ""));
  assert.equal(empty.improvedWhen, null);
  assert.equal(empty.source, "none");
  assert.ok(empty.basis.trim(), "even a refusal explains itself");
  // Total on garbage input.
  assert.doesNotThrow(() => inferMetricDirection({}));
});

test("the direction decides improved vs worsened, and the arithmetic is unchanged either way", () => {
  const start = { name: "turnaround", value: "3", unit: "days", period: "per estimate", source: "client" };
  const end = { name: "turnaround", value: "1", unit: "days", period: "per estimate", source: "client" };

  const lower = computeMetricDelta(start, end, { baselineConfirmed: true, improvedWhen: "lower" });
  assert.equal(lower.delta.direction, "decreased");
  assert.equal(lower.delta.interpretation, "improved", "3 days to 1 day is faster");

  const higher = computeMetricDelta(start, end, { baselineConfirmed: true, improvedWhen: "higher" });
  assert.equal(higher.delta.direction, "decreased", "arithmetic does not depend on interpretation");
  assert.equal(higher.delta.interpretation, "worsened");

  const undeclared = computeMetricDelta(start, end, { baselineConfirmed: true });
  assert.equal(undeclared.delta.interpretation, "not-interpreted");
});

const TRANSCRIPT = [
  "[00:10] Morgan: Estimates wait about three days for my approval.",
  "[00:40] Advisor: And who else can approve them?",
  "[01:05] Morgan: Nobody, it all comes back to me.",
].join("\n");

test("a fabricated client quote is rejected, not printed", () => {
  const lines = parseTranscriptText(TRANSCRIPT, { Morgan: "client" });
  const grounded = groundModelSynthesis(
    {
      quotes: [
        // Real, verbatim.
        { text: "Estimates wait about three days for my approval.", reason: "constraint evidence" },
        // Plausible, fluent, and never said. This is the failure the product cannot survive.
        { text: "We lose about forty thousand dollars a month to these delays.", reason: "cost of delay" },
      ],
    },
    lines,
  );
  const kept = grounded.quotes.map((quote) => quote.text);
  assert.equal(kept.length, 1);
  assert.match(kept[0], /Estimates wait about three days/);
  assert.equal(
    kept.some((text) => /forty thousand/.test(text)),
    false,
    "a quote absent from the transcript must never survive grounding",
  );
  assert.ok(
    grounded.rejections.some((item) => /forty thousand/.test(item.text)),
    "a rejected claim is recorded, so a silent drop cannot look like the model finding nothing",
  );
});

test("the model cannot promote an advisor line into client evidence", () => {
  const lines = parseTranscriptText(TRANSCRIPT, { Morgan: "client" });
  const grounded = groundModelSynthesis(
    { quotes: [{ text: "And who else can approve them?", reason: "constraint evidence" }] },
    lines,
  );
  assert.deepEqual(grounded.quotes, [], "the advisor's own words are not client evidence");
  assert.ok(grounded.rejections.length > 0);
});

test("grounded quotes are rewritten from the transcript, not from the model", () => {
  const lines = parseTranscriptText(TRANSCRIPT, { Morgan: "client" });
  const grounded = groundModelSynthesis(
    {
      quotes: [{
        // Right line, but the model paraphrased the speaker and invented a timestamp.
        text: "Nobody, it all comes back to me",
        speaker: "The owner",
        timestamp: "99:99",
        reason: "single point dependency",
      }],
    },
    lines,
  );
  assert.equal(grounded.quotes.length, 1);
  assert.equal(grounded.quotes[0].speaker, "Morgan", "speaker comes from the transcript");
  assert.equal(grounded.quotes[0].timestamp, "01:05", "timestamp comes from the transcript");
});
