import assert from "node:assert/strict";
import test from "node:test";

import { generateReadinessBrief } from "../lib/deliverables.ts";
import {
  requireApprovedReadinessArtifact,
  requireConsentAttestation,
  requireDiagnosisApprovalEvidence,
  requirePatchCommand,
} from "../lib/guards.ts";
import {
  assertPublicDns,
  extractPublicPage,
  readLimitedText,
  researchPublicWebsite,
  synthesizeResearch,
  validatePublicUrl,
} from "../lib/research.ts";
import {
  collectOpenAIWebSources,
  parseOpenAIResearchPayload,
} from "../lib/openai-research-schema.ts";
import {
  baselineStatusFor,
  extractMetrics,
  parseTranscriptText,
  synthesizeTranscript,
} from "../lib/transcript.ts";
import {
  assertWorkflowTransition,
  createDemoEngagement,
  stageForState,
} from "../lib/workflow.ts";

test("public research extracts only supplied page evidence", () => {
  const page = extractPublicPage(`
    <html><head><title>Acme Fabrication</title>
    <meta name="description" content="Custom fabrication with rapid turnaround."></head>
    <body><script>secret()</script><h1>Built for demanding projects</h1></body></html>
  `);
  assert.equal(page.title, "Acme Fabrication");
  assert.equal(page.description, "Custom fabrication with rapid turnaround.");
  assert.doesNotMatch(page.text, /secret/);

  const result = synthesizeResearch("https://acme.example/", page, "Acme");
  assert.equal(result.fetchStatus, "fetched");
  assert.equal(result.facts.every((fact) => fact.provenance === "public-research"), true);
  assert.equal(result.constraintHypotheses[0].type, "latency");
});

test("research fallback makes gaps instead of company claims", () => {
  const result = synthesizeResearch("https://offline.example/", null, "Offline Co");
  assert.equal(result.fetchStatus, "fallback");
  assert.deepEqual(result.facts, []);
  assert.equal(result.gaps.includes("End-to-end cycle time"), true);
  assert.match(result.description, /No company fact was inferred/);
});

test("OpenAI research keeps only source-backed canvas facts", () => {
  const response = {
    output: [{
      type: "web_search_call",
      action: {
        sources: [
          { type: "url", url: "https://acme.example/services" },
        ],
      },
    }],
  };
  const sources = collectOpenAIWebSources(response);
  const result = parseOpenAIResearchPayload({
    summary: "Acme serves industrial buyers.",
    facts: [
      {
        statement: "Acme offers custom fabrication.",
        canvas_block: "Value Propositions",
        source_label: "Acme services",
        source_url: "https://acme.example/services",
        confidence: 0.9,
      },
      {
        statement: "Acme has a hidden approval bottleneck.",
        canvas_block: "Key Activities",
        source_label: "Unsupported",
        source_url: "https://unsupported.example/claim",
        confidence: 0.9,
      },
    ],
    gaps: ["Monthly demand volume"],
    constraint_hypotheses: [{
      canvas_block: "Key Activities",
      type: "latency",
      evidence_hint: "Public copy emphasizes turnaround.",
      confirmation_condition: "Client evidence identifies a measurable delay.",
      kill_condition: "Flow evidence shows no limiting delay.",
    }],
  }, "https://acme.example/", sources);
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].canvasBlock, "Value Propositions");
  assert.equal(result.constraintHypotheses[0].type, "latency");
});

test("public URL guard rejects local and credential-bearing targets", () => {
  assert.throws(() => validatePublicUrl("http://127.0.0.1/admin"), /public website/);
  assert.throws(() => validatePublicUrl("https://user:pass@example.com/"), /without embedded credentials/);
  assert.equal(validatePublicUrl("https://example.com/about").hostname, "example.com");
  assert.equal(validatePublicUrl("www.tier4advisors.com").toString(), "https://www.tier4advisors.com/");
});

test("transcript parser preserves timestamp, speaker, and wording", () => {
  const lines = parseTranscriptText("[08:42] Morgan: Estimates wait three days for my approval.");
  assert.deepEqual(lines[0], {
    timestamp: "08:42",
    speaker: "Morgan",
    text: "Estimates wait three days for my approval.",
    speakerConfidence: "unknown",
    provenance: "client-stated",
  });
});

test("metric extraction does not invent a confirmed baseline", () => {
  const partialLines = parseTranscriptText("[00:10] Morgan: It takes about 3 days.");
  const partialMetrics = extractMetrics(partialLines);
  assert.equal(partialMetrics[0].value, "3 days");
  assert.equal(baselineStatusFor(partialMetrics), "Partial");

  const confirmedLines = parseTranscriptText("[00:10] Morgan: We handle 20 bids each week.");
  assert.equal(baselineStatusFor(extractMetrics(confirmedLines)), "Confirmed");
});

test("call 1 synthesis remains provisional even with metrics", () => {
  const result = synthesizeTranscript(
    "[00:10] Morgan: We handle 20 bids each week.\n[00:30] Morgan: Approval takes 3 days and the queue waits for me.",
    { client: "Acme", callNumber: 1, humanOwner: { name: "Morgan", role: "Owner" } },
  );
  assert.equal(result.baselineStatus, "Confirmed");
  assert.equal(result.constraintCandidate.findingStatus, "provisional");
  assert.equal(result.constraintCandidate.constraintType, "latency");
  assert.equal(result.quotes[0].provenance, "client-stated");
});

test("advisor and unknown speakers never become client evidence", () => {
  const result = synthesizeTranscript(
    "[00:10] Advisor: The queue looks slow.\nUnattributed transcript statement about a backlog.",
    { client: "Acme", callNumber: 1 },
  );
  assert.equal(result.constraintCandidate, null);
  assert.deepEqual(result.quotes, []);
  assert.equal(result.metrics.length, 0);
});

test("zero constraint signal yields no finding", () => {
  const result = synthesizeTranscript(
    "[00:10] Morgan: Thanks for meeting with us today.",
    { client: "Acme", callNumber: 1 },
  );
  assert.equal(result.constraintCandidate, null);
  assert.match(result.gaps[0], /No client-stated constraint signal/);
});

test("missing baseline blocks approved finding but allows provisional diagnosis checkpoint", () => {
  assert.doesNotThrow(() =>
    assertWorkflowTransition(
      "TRANSCRIPT_2_RECONCILED",
      "DIAGNOSIS_APPROVED",
      "Missing",
      "provisional",
    ),
  );
  assert.throws(() =>
    assertWorkflowTransition(
      "TRANSCRIPT_2_RECONCILED",
      "DIAGNOSIS_APPROVED",
      "Missing",
      "approved",
    ),
  /confirmed baseline/);
});

test("readiness brief omits diagnostic hypotheses and maps workflow stage", () => {
  const engagement = createDemoEngagement();
  const brief = generateReadinessBrief(engagement, { videoLink: "https://meet.example/session" });
  assert.doesNotMatch(brief, /constraint hypothes/i);
  assert.doesNotMatch(brief, /canvas v0/i);
  assert.match(brief, /Approximate is fine/);
  assert.equal(stageForState("DIAGNOSIS_APPROVED"), "Deliver");
});

test("approved readiness send binding rejects regenerated or mismatched artifacts", () => {
  const base = createDemoEngagement();
  const engagement = {
    ...base,
    data: {
      ...base.data,
      approvedReadinessBrief: {
        documentId: "doc_approved",
        approvedAt: "2026-07-24T12:00:00.000Z",
        approvedBy: "Advisor",
      },
    },
  };
  const approved = {
    id: "doc_approved",
    engagement_id: engagement.id,
    kind: "readiness_brief",
    status: "approved",
    content: "Immutable approved content",
  };
  assert.equal(requireApprovedReadinessArtifact(engagement, approved).content, approved.content);
  assert.throws(
    () => requireApprovedReadinessArtifact(engagement, { ...approved, id: "doc_regenerated" }),
    /missing, mismatched, or not approved/,
  );
});

test("diagnosis approval requires client evidence and named owner", () => {
  const result = synthesizeTranscript(
    "[00:10] Morgan: We process 20 bids each week and the queue waits for my approval.",
    {
      client: "Acme",
      callNumber: 2,
      humanOwner: { name: "Morgan", role: "Owner" },
    },
  );
  assert.ok(result.constraintCandidate);
  assert.doesNotThrow(() => requireDiagnosisApprovalEvidence(result.constraintCandidate));
  assert.throws(
    () => requireDiagnosisApprovalEvidence({
      ...result.constraintCandidate,
      humanOwner: { name: "", role: "" },
    }),
    /named human owner/,
  );
});

test("consent and command boundaries fail closed", () => {
  assert.throws(() => requireConsentAttestation(undefined), /consent attestation/);
  const consent = requireConsentAttestation({
    grantedBeforeCapture: true,
    attestedBy: "Advisor",
    attestedAt: "2026-07-24T12:00:00Z",
  });
  assert.equal(consent.attestedBy, "Advisor");
  assert.throws(
    () => requirePatchCommand({
      command: "update_metadata",
      expectedVersion: 1,
      fields: { workflowState: "DIAGNOSIS_APPROVED" },
    }),
    /protected field/,
  );
});

test("DNS, redirects, and response size checks fail closed", async () => {
  const privateResolver = async () => Response.json({
    Answer: [{ type: 1, data: "127.0.0.1" }],
  });
  await assert.rejects(
    () => assertPublicDns(new URL("https://example.com"), privateResolver),
    /non-public/,
  );
  await assert.rejects(
    () => readLimitedText(new Response("oversize", {
      headers: { "content-length": "500001" },
    })),
    /size limit/,
  );

  const publicResolver = async (input) => {
    const type = new URL(String(input)).searchParams.get("type");
    return Response.json({
      Answer: type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [],
    });
  };
  let fetches = 0;
  const redirectFetcher = async () => {
    fetches += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  };
  const result = await researchPublicWebsite(
    "https://example.com",
    "Acme",
    redirectFetcher,
    publicResolver,
  );
  assert.equal(result.fetchStatus, "fallback");
  assert.equal(fetches, 1);
});
