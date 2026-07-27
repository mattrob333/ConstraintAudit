import assert from "node:assert/strict";
import test from "node:test";

import { computeMetricDelta } from "../lib/workflow.ts";
import { requirePatchCommand } from "../lib/guards.ts";
import { parseTranscriptText, baselineStatusFor, extractMetrics } from "../lib/transcript.ts";
import { vttToTranscriptText } from "../lib/transcript-files.ts";
import { groundModelSynthesis } from "../lib/openai-transcript-schema.ts";

// Regressions for the bugs found in the 2026-07-27 code review. Each asserts the fixed
// behaviour on the exact input that previously failed.

test("a model value only grounds against a WHOLE number in the cited line", () => {
  const lines = parseTranscriptText("[00:10] Dana: We have about 1500 customers on the books.", { Dana: "client" });
  const fabricated = groundModelSynthesis(
    { metrics: [{ line: 1, quote: "We have about 1500 customers on the books.", label: "Monthly orders", value: "500", unit: "orders", period: "per month" }] },
    lines, [], {},
  );
  assert.equal(fabricated.metrics.length, 0, "'500' must not ground against a line that only says '1500'");
  assert.ok(fabricated.rejections.length >= 1);

  const real = groundModelSynthesis(
    { metrics: [{ line: 1, quote: "We have about 1500 customers on the books.", label: "Customers", value: "1500", unit: "customers", period: "total" }] },
    lines, [], {},
  );
  assert.equal(real.metrics.length, 1, "the real number still grounds");
});

test("the delta reads magnitude suffixes, so a revenue drop is not an improvement", () => {
  const { delta } = computeMetricDelta(
    { name: "rev", value: "$1.2m", unit: "dollars", period: "per month", source: "c" },
    { name: "rev", value: "$900k", unit: "dollars", period: "per month", source: "c" },
    { baselineConfirmed: true, improvedWhen: "higher" },
  );
  assert.equal(delta?.direction, "decreased");
  assert.equal(delta?.interpretation, "worsened");
  assert.equal(delta?.percent, "-25%");
});

test("a range value cannot anchor a delta or a confirmed baseline", () => {
  const { delta, blockedReason } = computeMetricDelta(
    { name: "t", value: "3 to 5 days", unit: "days", period: "per estimate", source: "c" },
    { name: "t", value: "4 days", unit: "days", period: "per estimate", source: "c" },
    { baselineConfirmed: true, improvedWhen: "lower" },
  );
  assert.equal(delta, null, "a range is not a single reading");
  assert.match(blockedReason ?? "", /not numeric/);

  const rangeLines = parseTranscriptText("[00:10] Dana: about 3 to 5 days per estimate.", { Dana: "client" });
  assert.equal(baselineStatusFor(extractMetrics(rangeLines)), "Partial", "a range must not be a Confirmed baseline");
});

test("a millisecond timestamp does not corrupt the speaker", () => {
  const lines = parseTranscriptText("[00:01:02.500] Bob: our backlog is huge.", { Bob: "advisor" });
  assert.equal(lines[0].speaker, "Bob");
  assert.equal(lines[0].provenance, "advisor-note", "the ms must not leak into the speaker and defeat the role map");
});

test("a VTT cue with no milliseconds is not silently dropped", () => {
  const out = vttToTranscriptText([
    "WEBVTT", "", "1", "00:00:05.000 --> 00:00:09.000", "Dana: first cue.",
    "", "2", "00:00:12 --> 00:00:16", "Dana: second cue with no milliseconds.",
  ].join("\n"));
  assert.match(out, /first cue/);
  assert.match(out, /second cue/, "the cue without a fractional second must survive");
});

test("the generic workflow advance cannot reach an evidence-gated state", () => {
  for (const nextState of ["DIAGNOSIS_APPROVED", "SPRINT_ACTIVE", "OUTCOME_MEASURED", "CATALOG_WRITTEN"]) {
    assert.throws(
      () => requirePatchCommand({ command: "advance_workflow", expectedVersion: 1, nextState }),
      /reviewed action/,
      `${nextState} must not be reachable through a direct advance`,
    );
  }
  // A synthesis state is entered by processing a transcript, never by a raw advance.
  assert.throws(
    () => requirePatchCommand({ command: "advance_workflow", expectedVersion: 1, nextState: "TRANSCRIPT_1_SYNTHESIZED" }),
    /reviewed action/,
  );
  // The Canvas commit is the one pure-advisor checkpoint the UI advances directly.
  assert.doesNotThrow(() =>
    requirePatchCommand({ command: "advance_workflow", expectedVersion: 1, nextState: "CANVAS_COMMIT_APPROVED" }));
});
