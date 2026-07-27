import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCanvasUpdates,
  buildCanvasFromResearch,
  canvasIsClientConfirmed,
  mergeCanvas,
} from "../lib/canvas.ts";
import { renderMarkdownToHtml } from "../lib/deliverables.ts";
import { synthesizeResearch } from "../lib/research.ts";
import {
  decodeTranscriptFile,
  detectTranscriptFormat,
  srtToTranscriptText,
  vttToTranscriptText,
} from "../lib/transcript-files.ts";
import { parseTranscriptText, synthesizeTranscript } from "../lib/transcript.ts";
import {
  CANVAS_BLOCKS,
  DISCOVERY_SECTIONS,
  canonicalCanvasBlock,
  computeMetricDelta,
} from "../lib/workflow.ts";

const DAYS = { name: "Approval turnaround", value: "3", unit: "days", period: "per estimate", source: "Ana, call 1" };
const confirmed = { baselineConfirmed: true };

const RESEARCH = {
  sourceUrl: "https://acme.example/",
  fetchedAt: "2026-07-26T00:00:00.000Z",
  fetchStatus: "fetched",
  title: "Acme Fabrication",
  description: "Custom fabrication with rapid turnaround.",
  facts: [
    {
      statement: "Acme offers custom metal fabrication.",
      provenance: "public-research",
      confidence: 0.9,
      sourceLabel: "Acme services",
      sourceUrl: "https://acme.example/services",
      canvasBlock: "Value Propositions",
    },
    {
      statement: "Acme lists three named supply partners.",
      provenance: "public-research",
      confidence: 0.7,
      sourceLabel: "Acme partners",
      sourceUrl: "https://acme.example/partners",
      // Legacy spelling: the audit report used to use this and silently dropped the block.
      canvasBlock: "Key Partnerships",
    },
  ],
  gaps: ["Monthly demand volume", "End-to-end cycle time"],
  constraintHypotheses: [{
    canvasBlock: "Key Activities",
    type: "latency",
    evidenceHint: "Public copy emphasizes turnaround.",
    confirmationCondition: "Client evidence identifies a measurable delay.",
    killCondition: "Flow evidence shows no limiting delay.",
  }],
};

test("canonical canvas is actually populated from research", () => {
  // The headline defect: generateAuditReport() read engagement.data.canvas, which nothing
  // ever wrote, so every block rendered as Missing.
  const canvas = buildCanvasFromResearch(RESEARCH);
  for (const block of CANVAS_BLOCKS) {
    assert.ok(Array.isArray(canvas[block]), `${block} must always exist`);
  }
  assert.equal(canvas["Value Propositions"][0].statement, "Acme offers custom metal fabrication.");
  assert.equal(canvas["Value Propositions"][0].provenance, "public-research");
  assert.equal(
    canvas["Key Partners"].some((claim) => claim.statement.includes("supply partners")),
    true,
    "the legacy Key Partnerships spelling must land in the canonical Key Partners block",
  );
  assert.equal(canonicalCanvasBlock("Key Partnerships"), "Key Partners");
  assert.equal(canonicalCanvasBlock("Not A Block"), null);
  assert.equal(canvasIsClientConfirmed(canvas), false);
});

test("client evidence supersedes research on the canvas without destroying it", () => {
  const canvas = applyCanvasUpdates(buildCanvasFromResearch(RESEARCH), [{
    canvasBlock: "Value Propositions",
    statement: "We only do structural steel now, not general fabrication.",
    quote: "We only do structural steel now, not general fabrication.",
    speaker: "Morgan",
    timestamp: "04:12",
    provenance: "client-stated",
    replacesResearchStatement: "Acme offers custom metal fabrication.",
  }]);
  const block = canvas["Value Propositions"];
  assert.equal(block[0].provenance, "client-stated", "client evidence ranks first");
  const superseded = block.find((claim) => claim.statement === "Acme offers custom metal fabrication.");
  assert.ok(superseded, "the corrected research claim is retained, not deleted");
  assert.match(superseded.sourceLabel, /superseded/i);
  assert.ok(
    superseded.confidence < 0.5,
    "a research claim the client corrected must lose confidence",
  );
  // Fail-closed: one corrected block does not make the whole Canvas client-confirmed.
  assert.equal(canvasIsClientConfirmed(canvas), false);
});

test("merging a canvas never downgrades client evidence to research", () => {
  const withClient = applyCanvasUpdates(buildCanvasFromResearch(RESEARCH), [{
    canvasBlock: "Channels",
    statement: "Every job arrives by word of mouth.",
    quote: "Every job arrives by word of mouth.",
    speaker: "Morgan",
    timestamp: "02:00",
    provenance: "client-stated",
  }]);
  const merged = mergeCanvas(withClient, buildCanvasFromResearch(RESEARCH));
  assert.equal(
    merged["Channels"].some((claim) => claim.provenance === "client-stated"),
    true,
    "re-running research must not wipe a client-confirmed block",
  );
});

test("research proposes a company value flow and anchored questions with no API key", () => {
  const page = {
    title: "Acme Fabrication",
    description: "Custom fabrication with rapid turnaround.",
    text: "Request a quote for your project. We schedule installation and handle warranty support.",
  };
  const result = synthesizeResearch("https://acme.example/", page, "Acme");

  assert.ok(result.valueFlow?.length, "a deterministic flow must exist without OpenAI configured");
  assert.deepEqual(
    result.valueFlow.map((step) => step.order),
    result.valueFlow.map((_, index) => index + 1),
    "flow order is sequential",
  );
  for (const step of result.valueFlow) {
    assert.ok(["public-research", "advisor-note", "gap"].includes(step.evidenceStatus));
    assert.notEqual(step.evidenceStatus, "client-stated");
    assert.ok(step.confirmationQuestion.trim(), "every unconfirmed step carries a confirmation question");
    assert.ok(step.confidence <= 0.5, "public research is never high-confidence about internal flow");
  }

  assert.ok(result.discoveryQuestions?.length, "questions must exist without OpenAI configured");
  const sections = new Set(result.discoveryQuestions.map((question) => question.section));
  for (const section of DISCOVERY_SECTIONS) {
    assert.ok(sections.has(section), `discovery must cover the ${section} section`);
  }
  for (const question of result.discoveryQuestions) {
    // The exact generic wrapper this work replaced.
    assert.doesNotMatch(question.question, /^Could \w+ be limiting/i);
    assert.ok(question.whyItMatters.trim());
  }
  assert.ok(
    result.discoveryQuestions.some((question) => question.expectedAnswerType === "number"),
    "baseline questions must ask for a number so the baseline can stop being Missing",
  );
});

test("two different companies produce materially different flows and questions", () => {
  // The whole point of the research contract: the call script must belong to this
  // company. Before this work every engagement got the same six steps and six questions.
  const fabricator = synthesizeResearch("https://acme-fab.example/", {
    title: "Acme Fabrication",
    description: "Custom structural steel fabrication.",
    text: "Request a quote for your project. We schedule installation on site and handle warranty support after handover.",
  }, "Acme Fabrication");

  const clinic = synthesizeResearch("https://brightsmile.example/", {
    title: "Brightsmile Dental",
    description: "Family dental care with same-week appointments.",
    text: "Book an appointment online. New patients complete onboarding before their first consultation, and we bill insurance directly.",
  }, "Brightsmile Dental");

  const names = (result) => (result.valueFlow ?? []).map((step) => step.name);
  assert.notDeepEqual(names(fabricator), names(clinic), "two companies must not share one flow");
  assert.ok(
    names(fabricator).some((name) => !names(clinic).includes(name)),
    "at least one flow step must be unique to the fabricator",
  );

  const questions = (result) => (result.discoveryQuestions ?? []).map((item) => item.question);
  const shared = questions(fabricator).filter((question) => questions(clinic).includes(question));
  assert.ok(
    shared.length < questions(fabricator).length,
    "the two question sets must not be identical",
  );

  // Both must still cover every required section — divergence cannot cost coverage.
  for (const result of [fabricator, clinic]) {
    const sections = new Set((result.discoveryQuestions ?? []).map((item) => item.section));
    for (const section of DISCOVERY_SECTIONS) {
      assert.ok(sections.has(section), `${result.title} must still cover ${section}`);
    }
  }
});

test("research fallback still refuses to invent a flow it cannot see", () => {
  const result = synthesizeResearch("https://offline.example/", null, "Offline Co");
  assert.ok(result.valueFlow?.length);
  assert.equal(
    result.valueFlow.every((step) => step.evidenceStatus === "gap" && step.sourceUrls.length === 0),
    true,
    "with no readable page every step is an explicit gap",
  );
});

test("VTT and SRT decode into speaker-attributed transcript lines", () => {
  const vtt = vttToTranscriptText([
    "WEBVTT",
    "",
    "NOTE this is a comment",
    "",
    "1",
    "00:00:05.000 --> 00:00:09.000",
    "<v Morgan>Estimates wait three days for my approval.</v>",
    "",
    "2",
    "00:01:20.500 --> 00:01:24.000",
    "Advisor: And who signs off on those?",
  ].join("\n"));
  const vttLines = parseTranscriptText(vtt, { Morgan: "client" });
  assert.equal(vttLines[0].timestamp, "00:05");
  assert.equal(vttLines[0].speaker, "Morgan");
  assert.equal(vttLines[0].text, "Estimates wait three days for my approval.");
  assert.equal(vttLines[0].provenance, "client-stated");
  assert.equal(vttLines[1].provenance, "advisor-note", "the advisor is never client evidence");
  assert.doesNotMatch(vtt, /WEBVTT|NOTE/);

  const srtLines = parseTranscriptText(srtToTranscriptText([
    "1",
    "00:00:05,000 --> 00:00:09,000",
    "Morgan: We turn around twenty bids each week.",
  ].join("\n")), { Morgan: "client" });
  assert.equal(srtLines[0].speaker, "Morgan");
  assert.equal(srtLines[0].timestamp, "00:05");
});

test("uploaded transcript files carry real content, not a filename", async () => {
  assert.equal(detectTranscriptFormat("call.vtt"), "vtt");
  assert.equal(detectTranscriptFormat("call.srt"), "srt");
  assert.equal(detectTranscriptFormat("call.docx"), "docx");

  const decoded = await decodeTranscriptFile({
    name: "call-1.txt",
    content: "[00:10] Morgan: Approval takes three days and the queue waits for me.",
    encoding: "utf8",
  });
  assert.match(decoded.text, /Approval takes three days/);
  // The old build submitted "Transcript file selected: <name>" and nothing else.
  assert.doesNotMatch(decoded.text, /Transcript file selected/);

  const synthesis = synthesizeTranscript(decoded.text, { client: "Acme", callNumber: 1, speakerRoles: { Morgan: "client" } });
  assert.ok(synthesis.constraintCandidate, "real file content produces real evidence");
  assert.equal(synthesis.quotes[0].provenance, "client-stated");
});

test("a measured change is never called an improvement without being told which way is better", () => {
  const faster = { ...DAYS, value: "1", source: "Ana, sprint review" };

  // Turnaround 3 days -> 1 day. The arithmetic went down; that is a win here, but the
  // app cannot know that on its own, so it must refuse to characterize it.
  const undeclared = computeMetricDelta(DAYS, faster, confirmed);
  assert.equal(undeclared.delta.direction, "decreased");
  assert.equal(undeclared.delta.interpretation, "not-interpreted");

  const declaredLower = computeMetricDelta(DAYS, faster, { ...confirmed, improvedWhen: "lower" });
  assert.equal(declaredLower.delta.interpretation, "improved");
  assert.equal(declaredLower.delta.absolute, "-2 days");
  assert.equal(declaredLower.delta.percent, "-66.7%");

  // The same arithmetic on a throughput metric is a regression.
  const declaredHigher = computeMetricDelta(DAYS, faster, { ...confirmed, improvedWhen: "higher" });
  assert.equal(declaredHigher.delta.interpretation, "worsened");

  const unchanged = computeMetricDelta(DAYS, { ...DAYS, source: "Ana, sprint review" }, confirmed);
  assert.equal(unchanged.delta.direction, "unchanged");
  assert.equal(unchanged.delta.interpretation, "unchanged");
});

test("a delta is blocked rather than invented whenever the readings do not support one", () => {
  const unconfirmed = computeMetricDelta(DAYS, { ...DAYS, value: "1" }, { baselineConfirmed: false });
  assert.equal(unconfirmed.delta, null);
  assert.match(unconfirmed.blockedReason, /never confirmed/);

  const mismatched = computeMetricDelta(DAYS, { ...DAYS, value: "18", unit: "hours" }, confirmed);
  assert.equal(mismatched.delta, null);
  // Reads "days per estimate", not "days per per estimate".
  assert.equal(mismatched.blockedReason, "Readings are not comparable (days per estimate vs hours per estimate).");

  const nonNumeric = computeMetricDelta(DAYS, { ...DAYS, value: "much faster" }, confirmed);
  assert.equal(nonNumeric.delta, null);
  assert.match(nonNumeric.blockedReason, /not numeric/);

  const noBaseline = computeMetricDelta(undefined, { ...DAYS, value: "1" }, confirmed);
  assert.equal(noBaseline.delta, null);
});

test("rendered document HTML escapes content instead of executing it", () => {
  const html = renderMarkdownToHtml(
    "# Report\n\nA quote: <script>alert(1)</script> and **bold** text.\n\n- one\n- two\n",
    "Acme Report",
  );
  assert.match(html, /<h1[^>]*>Report<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
  assert.doesNotMatch(html, /<script>alert/, "document content must never become live markup");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /charset/i);
  assert.doesNotMatch(html, /https?:\/\/(?!acme)[^"']*\.(?:css|js)/, "no external assets — CSP-safe and offline");
});
