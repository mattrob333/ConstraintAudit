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
