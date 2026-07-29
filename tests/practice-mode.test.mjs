import assert from "node:assert/strict";
import test from "node:test";

import { generateFindingsAgenda } from "../lib/deliverables.ts";
import {
  DEMO_OWNER_MARKER,
  buildDemoEngagement,
  demoArtifacts,
  demoEngagementIdFor,
  demoFinding,
  demoTranscript,
  isDemoEngagement,
} from "../lib/demo.ts";
import { parseTranscriptText } from "../lib/transcript.ts";

const SEEDED_AT = "2026-06-26T11:00:00.000Z";
const engagement = buildDemoEngagement("own_test", SEEDED_AT);

function transcriptLines() {
  return [1, 2].flatMap((callNumber) => parseTranscriptText(demoTranscript(callNumber)));
}

function normalize(value) {
  return value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
}

test("practice data is deterministic so every advisor is trained on the same example", () => {
  const a = buildDemoEngagement("own_test", SEEDED_AT);
  const b = buildDemoEngagement("own_test", SEEDED_AT);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(demoTranscript(1), demoTranscript(1));
  // Two advisors must not collide on one row.
  assert.notEqual(demoEngagementIdFor("own_a"), demoEngagementIdFor("own_b"));
  assert.equal(isDemoEngagement(demoEngagementIdFor("own_a")), true);
  assert.equal(isDemoEngagement("eng_real_client"), false);
});

test("practice data is unmistakably fake and says so", () => {
  assert.match(engagement.notes, new RegExp(DEMO_OWNER_MARKER.slice(0, 24), "i"));
  assert.match(engagement.notes, /never send to a client/i);
  // Nothing that could be mistaken for a real company's contact details.
  assert.match(engagement.email, /@example\.com$/);
  assert.match(engagement.website, /example\.com/);
});

test("every quote the diagnosis rests on appears verbatim in a real transcript line", () => {
  const lines = transcriptLines();
  const spoken = new Set(lines.map((line) => normalize(line.text)));
  const finding = demoFinding();
  assert.ok(finding.evidence.length, "the worked example must carry client evidence");
  for (const item of finding.evidence) {
    assert.ok(
      spoken.has(normalize(item.quote)),
      `finding evidence not found verbatim in any transcript line: ${item.quote}`,
    );
    assert.equal(item.provenance, "client-stated");
    assert.ok(item.speaker.trim() && item.timestamp.trim());
  }
});

test("the practice transcripts demonstrate that the advisor is never client evidence", () => {
  const lines = transcriptLines();
  const advisor = lines.filter((line) => line.speaker.toLowerCase().includes("advisor"));
  assert.ok(advisor.length > 10, "the demo should visibly contain advisor turns");
  assert.equal(
    advisor.every((line) => line.provenance === "advisor-note"),
    true,
    "an advisor line must never be labelled client-stated, even in training data",
  );
  const finding = demoFinding();
  const advisorText = new Set(advisor.map((line) => normalize(line.text)));
  for (const item of finding.evidence) {
    assert.equal(advisorText.has(normalize(item.quote)), false, "advisor words leaked into evidence");
  }
});

test("the findings agenda reads back only figures that bear on the constraint", () => {
  const body = generateFindingsAgenda(engagement, demoFinding())
    .sections.find((section) => /what we heard/i.test(section.heading)).body;
  // "four years years" — value already carries its unit, so it must not be appended twice.
  assert.doesNotMatch(body, /\b(\w+)\s+\1\b/, "a unit was repeated in a client-facing line");
  assert.doesNotMatch(body, /Client-stated \w+ metric/, "internal label leaked into client-facing copy");
  const quoted = body.split("\n").filter((line) => line.startsWith("- ") && line.includes("“"));
  assert.ok(quoted.length <= 6, `client-facing number list must stay readable, got ${quoted.length}`);
  // The baseline the whole diagnosis rests on has to survive the filter.
  assert.ok(quoted.some((line) => line.includes("9 days")), "the baseline figure was filtered out");
});

test("practice artifacts generate real content across the whole arc", () => {
  const artifacts = demoArtifacts(engagement);
  const kinds = new Set(artifacts.map((artifact) => artifact.kind));
  for (const kind of ["company_brief", "readiness_brief", "audit_report", "proposal", "outcome_report"]) {
    assert.ok(kinds.has(kind), `practice mode should include a ${kind}`);
  }
  assert.equal(artifacts.every((artifact) => artifact.content.trim().length > 0), true);
});

test("the measured outcome reads as an improvement without anyone declaring it", () => {
  const outcome = engagement.data.outcome;
  assert.ok(outcome?.delta, "the worked example must show a real before/after");
  assert.equal(outcome.delta.direction, "decreased");
  assert.equal(outcome.delta.interpretation, "improved");
  assert.equal(outcome.improvedWhen, "lower");
  assert.notEqual(outcome.directionInference?.source, "advisor");
});

test("the worked example tests its own kill condition against a business number", () => {
  const finding = demoFinding();
  const outcome = engagement.data.outcome;
  // The structured condition stands beside the client's verbatim sentence, never instead of it.
  assert.match(finding.killCondition, /win rate does not move/i);
  assert.deepEqual(finding.killConditionSpec, {
    metric: "Win rate on quoted work",
    comparator: "does-not-move",
    threshold: "no increase from 20 percent",
    window: "4 weeks",
  });
  // Every part of the spec has to be traceable to something the client actually said.
  const spoken = transcriptLines().map((line) => normalize(line.text)).join(" ");
  assert.ok(spoken.includes("20 percent"), "the threshold's number is client-stated");
  assert.ok(spoken.includes("four weeks"), "the window is client-stated");

  // Audit F2: the constraint is only "confirmed" if the number it was meant to move was checked.
  assert.equal(outcome.killConditionResult, "held");
  assert.ok(outcome.businessMetric, "the business number must be on the outcome, not only the turnaround");
  assert.equal(outcome.businessMetric.starting.value, "20");
  assert.equal(outcome.businessMetric.ending.value, "26");
  assert.notEqual(
    outcome.businessMetric.ending.name,
    outcome.endingMetric.name,
    "the business metric is not the operational metric",
  );
  // The after reading was taken at the review meeting, so it is quoted in the outcome evidence
  // and must NOT have been retro-fitted into a transcript that happened weeks earlier.
  assert.ok(
    outcome.evidence.some((item) => /twenty-six percent/i.test(item.quote)),
    "the post-sprint reading is quoted where it was actually recorded",
  );
  assert.match(outcome.businessMetric.ending.source, /measurement call/i);
  assert.equal(
    transcriptLines().some((line) => /twenty-six|26 percent/i.test(line.text)),
    false,
    "a post-sprint number must never appear in a call transcript recorded before it",
  );
  // ...and the entry that gets written back records which way the test went.
  assert.equal(engagement.data.catalogEntry.killConditionResult, "held");
});
