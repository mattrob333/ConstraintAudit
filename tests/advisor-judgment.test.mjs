import assert from "node:assert/strict";
import test from "node:test";

import { demoBaseline, demoFinding, demoModelPayload, demoSpeakerRoles, demoTranscript } from "../lib/demo.ts";
import { applyFindingEdits, evidenceKey } from "../lib/finding-edit.ts";
import { requireDiagnosisApprovalEvidence } from "../lib/guards.ts";
import { synthesizeTranscriptWithOpenAI } from "../lib/openai-transcript.ts";
import { groundModelSynthesis, killConditionSpecFrom } from "../lib/openai-transcript-schema.ts";
import { parseTranscriptText } from "../lib/transcript.ts";
import { assertWorkflowTransition, baselineMetricIsBound } from "../lib/workflow.ts";

/**
 * The advisor's judgment layer over the diagnosis (audit C1, C17) and the outcome finally
 * testing the client's own kill condition (audit F2, F6). Everything here is the *rules*:
 * what an advisor may change, what that does to the finding's status, and which checkpoints
 * refuse to move while the evidence does not support them.
 */

const NOW = { editedAt: "2026-07-29T12:00:00.000Z", editedBy: "advisor@example.com" };

/** A stored engagement's `data`, with the two grounded call transcripts behind it. */
function storedData() {
  const finding = demoFinding();
  return {
    finding,
    baseline: demoBaseline(),
    transcriptSynthesis: [
      {
        callNumber: 1,
        quotes: parseTranscriptText(demoTranscript(1), demoSpeakerRoles())
          .filter((line) => line.provenance === "client-stated")
          .map((line) => ({ ...line, reason: "Cited on the call." })),
        metrics: [],
      },
    ],
  };
}

/* -------------------------------------------------- the workflow gates */

test("an approved finding needs a baseline bound to the constraint, not just a Confirmed column", () => {
  const bound = { name: "Quote turnaround time", value: "9", unit: "days", period: "per quote", source: "Rosa Alvarez at 04:43: It is more like 9 days per quote." };
  const missing = { name: "", value: "", unit: "", period: "", source: "Missing" };
  assert.equal(baselineMetricIsBound(bound), true);
  assert.equal(baselineMetricIsBound(missing), false);
  assert.equal(baselineMetricIsBound(undefined), false);
  assert.equal(baselineMetricIsBound({ ...bound, source: "Missing: confirm with client" }), false);

  assert.doesNotThrow(() =>
    assertWorkflowTransition("TRANSCRIPT_2_RECONCILED", "DIAGNOSIS_APPROVED", "Confirmed", "approved", {
      baselineMetric: bound,
    }));
  // The engagement column says Confirmed; the finding's own baseline measures nothing.
  assert.throws(
    () => assertWorkflowTransition("TRANSCRIPT_2_RECONCILED", "DIAGNOSIS_APPROVED", "Confirmed", "approved", {
      baselineMetric: missing,
    }),
    /baseline bound to the constraint/,
  );
  // Absent evidence reads as unbound: the gate fails closed rather than open.
  assert.throws(
    () => assertWorkflowTransition("TRANSCRIPT_2_RECONCILED", "DIAGNOSIS_APPROVED", "Confirmed", "approved"),
    /baseline bound to the constraint/,
  );
  // A provisional finding is still allowed through the checkpoint, exactly as before.
  assert.doesNotThrow(() =>
    assertWorkflowTransition("TRANSCRIPT_2_RECONCILED", "DIAGNOSIS_APPROVED", "Missing", "provisional"));
});

test("the catalog write-back is blocked while the kill condition is untested", () => {
  const gate = (killConditionResult) =>
    assertWorkflowTransition("OUTCOME_MEASURED", "CATALOG_WRITTEN", "Confirmed", "approved", { killConditionResult });
  assert.throws(() => gate("not-tested"), /kill condition is untested/);
  // Absent is not "fine", it is untested.
  assert.throws(() => gate(undefined), /kill condition is untested/);
  assert.doesNotThrow(() => gate("held"));
  // A disproven constraint is a first-class honest outcome and still writes.
  assert.doesNotThrow(() => gate("fired"));
});

/* ------------------------------------------- the advisor baseline override */

test("the advisor baseline override rejects a value that is not a comparable reading", () => {
  const data = storedData();
  assert.throws(
    () => applyFindingEdits(data, data.finding, {
      baseline: { name: "Quote turnaround", value: "nine-ish", unit: "days", period: "per quote", source: "Rosa Alvarez at 04:43: It is more like 9 days per quote." },
    }, NOW),
    /not a single comparable reading/,
  );
  // A range is a spread, not a reading, so it cannot anchor a before/after either.
  assert.throws(
    () => applyFindingEdits(data, data.finding, {
      baseline: { name: "Quote turnaround", value: "3 to 5", unit: "days", period: "per quote", source: "Rosa Alvarez at 04:43: It is more like 9 days per quote." },
    }, NOW),
    /not a single comparable reading/,
  );
});

test("the advisor baseline override rejects a source that resolves to no client line", () => {
  const data = storedData();
  assert.throws(
    () => applyFindingEdits(data, data.finding, {
      baseline: { name: "Quote turnaround", value: "9", unit: "days", period: "per quote", source: "Dana said so" },
    }, NOW),
    /does not match any client line on record/,
  );
  // Quoting the line resolves it...
  const quoted = applyFindingEdits(data, data.finding, {
    baseline: { name: "Quote turnaround time", value: "9", unit: "days", period: "per quote", source: "It is more like 9 days per quote." },
  }, NOW);
  assert.equal(quoted.baselineConfirmed, true);
  // ...and so does naming the speaker and the timestamp of a stored line.
  const referenced = applyFindingEdits(data, data.finding, {
    baseline: { name: "Quote turnaround time", value: "9", unit: "days", period: "per quote", source: "Rosa Alvarez at 04:43, from her enquiry log" },
  }, NOW);
  assert.equal(referenced.baselineConfirmed, true);
});

test("an advisor-attested reading is accepted, stamped, and caps the finding at provisional", () => {
  const data = storedData();
  const result = applyFindingEdits(data, data.finding, {
    baseline: {
      name: "Quote turnaround time", value: "9", unit: "days", period: "per quote",
      source: "My own reading of the log while I sat with Rosa",
      attestation: "advisor-attested",
    },
  }, NOW);
  assert.equal(result.advisorAttested, true);
  assert.equal(result.baselineConfirmed, false, "the advisor's word is not a client-confirmed baseline");
  assert.equal(result.finding.findingStatus, "provisional");
  assert.match(result.baseline.source, /^Advisor-attested:/, "the provenance is stamped into the source itself");
  assert.equal(result.finding.baselineInstrumentation.required, true);
  // The cap survives a later save that does not touch the baseline at all.
  const later = applyFindingEdits({ ...data, finding: result.finding }, result.finding, { killCondition: "Anything." }, NOW);
  assert.equal(later.baselineConfirmed, false);
  assert.equal(later.finding.findingStatus, "provisional");
});

/* -------------------------------------------------- the findings editor */

test("the editor accepts every judgment field and records each one beside the model's original", () => {
  const data = storedData();
  const original = data.finding;
  const result = applyFindingEdits(data, original, {
    constraintType: "latency",
    canvasBlock: "Key Activities",
    prescription: "Rosa returns book-covered enquiries the same day.",
    whySmallestIntervention: "It hires nobody and buys nothing.",
    killCondition: "Three days and no more won work.",
    killConditionSpec: { metric: "Win rate on quoted work", comparator: "does-not-move", threshold: "no increase from 20 percent", window: "6 weeks" },
    predictedNextConstraint: "Shop drawings.",
    appendixItems: { add: ["CNC nesting rests on one person."], remove: [original.appendixItems[0]] },
  }, NOW);

  assert.equal(result.finding.constraintType, "latency");
  assert.equal(result.finding.canvasBlock, "Key Activities");
  assert.equal(result.finding.prescription.description, "Rosa returns book-covered enquiries the same day.");
  assert.equal(result.finding.killConditionSpec.window, "6 weeks");
  assert.ok(result.finding.appendixItems.includes("CNC nesting rests on one person."));
  assert.ok(!result.finding.appendixItems.includes(original.appendixItems[0]));

  const edited = new Map(result.finding.advisorEdits.map((edit) => [edit.field, edit]));
  for (const field of ["constraintType", "prescription", "whySmallestIntervention", "killCondition", "killConditionSpec", "predictedNextConstraint", "appendixItems"]) {
    assert.ok(edited.has(field), `${field} should be recorded as an advisor edit`);
    assert.equal(edited.get(field).editedBy, NOW.editedBy);
  }
  assert.equal(edited.get("constraintType").original, original.constraintType);
  assert.equal(edited.get("prescription").original, original.prescription.description);
  // The canvas block did not actually change, so nothing is recorded for it.
  assert.equal(edited.has("canvasBlock"), false);

  // An edit of an edit keeps the MODEL's original, not the advisor's previous wording.
  const again = applyFindingEdits({ ...data, finding: result.finding }, result.finding, {
    prescription: "A one-page price book, owned by Dana.",
  }, NOW);
  const twice = again.finding.advisorEdits.find((edit) => edit.field === "prescription");
  assert.equal(twice.original, original.prescription.description);
  assert.equal(twice.edited, "A one-page price book, owned by Dana.");

  // Editing is never approval.
  assert.notEqual(result.finding.findingStatus, "approved");
});

test("the editor refuses values it cannot honestly store", () => {
  const data = storedData();
  assert.throws(() => applyFindingEdits(data, data.finding, { constraintType: "vibes" }, NOW), /is not a constraint type/);
  assert.throws(() => applyFindingEdits(data, data.finding, { canvasBlock: "Vibes" }, NOW), /Canvas block/);
  // A part-filled kill condition is no kill condition; the verbatim sentence stands alone.
  assert.throws(
    () => applyFindingEdits(data, data.finding, { killConditionSpec: { metric: "Win rate", comparator: "does-not-move", threshold: "", window: "4 weeks" } }, NOW),
    /needs a metric, a comparator/,
  );
  // Clearing it is explicit and leaves the client's own sentence untouched.
  const cleared = applyFindingEdits(data, data.finding, { killConditionSpec: null }, NOW);
  assert.equal(cleared.finding.killConditionSpec, undefined);
  assert.equal(cleared.finding.killCondition, data.finding.killCondition);
});

test("evidence is a selection over grounded lines, and dropping below two blocks approval", () => {
  const data = storedData();
  const finding = data.finding;
  const keys = finding.evidence.map(evidenceKey);

  // Excluding is allowed even when it takes the finding under the bar...
  const thinned = applyFindingEdits(data, finding, { evidence: { exclude: keys.slice(1) } }, NOW);
  assert.equal(thinned.finding.evidence.length, 1);
  assert.throws(
    () => requireDiagnosisApprovalEvidence({ ...thinned.finding, humanOwner: finding.humanOwner }),
    /at least 2 distinct client-stated quotes/,
    "...and approval is what refuses, with a reason the advisor can act on",
  );
  // Re-including from the pool restores it.
  const restored = applyFindingEdits({ ...data, finding: thinned.finding }, thinned.finding, {
    evidence: { include: [keys[1]] },
  }, NOW);
  assert.equal(restored.finding.evidence.length, 2);
  assert.doesNotThrow(() => requireDiagnosisApprovalEvidence(restored.finding));

  // Nothing the advisor types can become a citation.
  assert.throws(
    () => applyFindingEdits(data, finding, { evidence: { include: ["04:43|dana told me the queue is the problem"] } }, NOW),
    /Evidence can only be selected from lines the client actually said/,
  );
  for (const item of restored.finding.evidence) assert.equal(item.provenance, "client-stated");
});

/* ------------------------------------------- the structured kill condition */

test("a kill condition spec is all four parts or nothing", () => {
  assert.deepEqual(
    killConditionSpecFrom({ metric: "Win rate", comparator: "does-not-move", threshold: "no increase from 20 percent", window: "4 weeks" }),
    { metric: "Win rate", comparator: "does-not-move", threshold: "no increase from 20 percent", window: "4 weeks" },
  );
  assert.equal(killConditionSpecFrom({ metric: "Win rate", comparator: "does-not-move", threshold: "flat", window: "" }), null);
  assert.equal(killConditionSpecFrom({ metric: "", comparator: "does-not-move", threshold: "flat", window: "4 weeks" }), null);
  assert.equal(killConditionSpecFrom({ metric: "Win rate", comparator: "wobbles", threshold: "flat", window: "4 weeks" }), null);
  assert.equal(killConditionSpecFrom({}), null);
});

test("the model's kill condition spec is grounded, and a half-filled one is dropped and reported", () => {
  const lines = parseTranscriptText(demoTranscript(2), demoSpeakerRoles());
  const payload = demoModelPayload();
  const grounded = groundModelSynthesis(payload, lines, [], {});
  assert.ok(grounded.constraint, "the practice payload must still ground");
  assert.deepEqual(grounded.constraint.killConditionSpec, {
    metric: "Win rate on quoted work",
    comparator: "does-not-move",
    threshold: "no increase from 20 percent",
    window: "4 weeks",
  });

  const halfFilled = groundModelSynthesis({
    ...payload,
    constraint: { ...payload.constraint, kill_condition_spec: { metric: "Win rate", comparator: "does-not-move", threshold: "", window: "" } },
  }, lines, [], {});
  assert.equal(halfFilled.constraint.killConditionSpec, null, "an invented window is worse than no spec");
  assert.equal(halfFilled.constraint.killCondition, payload.constraint.kill_condition, "the client's sentence still stands");
  assert.ok(
    halfFilled.rejections.some((item) => item.kind === "constraint.kill_condition_spec"),
    "the drop is recorded, not silent",
  );

  // An empty spec is the model's honest "the client never committed to this", not a failure.
  const empty = groundModelSynthesis({
    ...payload,
    constraint: { ...payload.constraint, kill_condition_spec: { metric: "", comparator: "", threshold: "", window: "" } },
  }, lines, [], {});
  assert.equal(empty.constraint.killConditionSpec, null);
  assert.equal(
    empty.rejections.some((item) => item.kind === "constraint.kill_condition_spec"),
    false,
  );
});

/* ------------------------------------------------- the provider retry path */

/** Credentials the resolver would return, so no Worker binding is touched in this process. */
function credentials(values) {
  return { get: (name) => values[name] ?? "", sourceOf: () => "saved-in-app" };
}

function baseSynthesis() {
  return {
    callNumber: 2,
    lineCount: 1,
    quotes: [],
    metrics: [],
    baselineStatus: "Missing",
    gaps: [],
    constraintCandidate: null,
  };
}

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
    }),
  };
}

test("a 5xx is retried once and the second answer is the one that is used", async () => {
  const lines = parseTranscriptText(demoTranscript(2), demoSpeakerRoles());
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    if (calls.length === 1) {
      return { ok: false, status: 503, json: async () => ({ error: { message: "upstream busy" } }) };
    }
    assert.ok(init.body.includes("kill_condition_spec"), "the schema the retry sends is the same one");
    return okResponse(demoModelPayload());
  };
  const result = await synthesizeTranscriptWithOpenAI(
    baseSynthesis(),
    { lines, client: "Meridian Millwork", callNumber: 2 },
    fetcher,
    credentials({ OPENAI_API_KEY: "sk-test", OPENAI_TRANSCRIPT_MODEL: "test-model" }),
  );
  assert.equal(calls.length, 2, "the transient failure is retried exactly once");
  assert.equal(result.modelStatus, "used");
  assert.equal(result.analysisMode, "model-assisted");
  assert.equal(result.providerModel, "test-model");
  assert.ok(result.constraintCandidate, "the second answer produced a real finding");
  assert.equal(result.constraintCandidate.killConditionSpec.window, "4 weeks");
});

test("a 4xx is not retried, and the failure is reported rather than silently degraded", async () => {
  const lines = parseTranscriptText(demoTranscript(2), demoSpeakerRoles());
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: false, status: 400, json: async () => ({ error: { message: "bad request" } }) };
  };
  const result = await synthesizeTranscriptWithOpenAI(
    baseSynthesis(),
    { lines, client: "Meridian Millwork", callNumber: 2 },
    fetcher,
    credentials({ OPENAI_API_KEY: "sk-test", OPENAI_TRANSCRIPT_MODEL: "test-model" }),
  );
  assert.equal(calls, 1, "asking again would only produce the same reply more slowly");
  assert.equal(result.modelStatus, "failed");
  assert.equal(result.analysisMode, "deterministic");
});

test("two transient failures stop at the deterministic reading, marked failed", async () => {
  const lines = parseTranscriptText(demoTranscript(2), demoSpeakerRoles());
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const result = await synthesizeTranscriptWithOpenAI(
    baseSynthesis(),
    { lines, client: "Meridian Millwork", callNumber: 2 },
    fetcher,
    credentials({ OPENAI_API_KEY: "sk-test", OPENAI_TRANSCRIPT_MODEL: "test-model" }),
  );
  assert.equal(calls, 2, "one retry, not a loop");
  assert.equal(result.modelStatus, "failed");
  assert.equal(result.constraintCandidate, null, "nothing is invented to fill the gap");
});
