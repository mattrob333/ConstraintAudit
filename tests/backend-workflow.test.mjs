import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuditInviteEmail,
  buildAuditInvitePayload,
  headcountBandFromEmployees,
  mapCsvHeaders,
  parseCsv,
  planClientImport,
} from "../lib/clients.ts";
import { generateReadinessBrief } from "../lib/deliverables.ts";
import {
  requireApprovedReadinessArtifact,
  requireConsentAttestation,
  requireDiagnosisApprovalEvidence,
  requireInvitableClient,
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
  INTENT_TYPES,
  assertWorkflowTransition,
  createDemoEngagement,
  normalizeFirmographics,
  stageForState,
} from "../lib/workflow.ts";

/** One roster row, in the shape the store returns. */
function client(overrides = {}) {
  return {
    id: "cli_one",
    ownerId: "owner_1",
    company: "Acme Industrial",
    website: "https://acme.example",
    contactName: "Maya Chen",
    contactRole: "Chief Operating Officer",
    email: "maya@acme.example",
    industry: "Manufacturing",
    headcountBand: "50-249",
    phone: "",
    source: "csv",
    status: "none",
    engagementId: "",
    invitedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

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
  const lines = parseTranscriptText("[08:42] Morgan: Estimates wait three days for my approval.", { Morgan: "client" });
  assert.deepEqual(lines[0], {
    timestamp: "08:42",
    speaker: "Morgan",
    text: "Estimates wait three days for my approval.",
    speakerConfidence: "unknown",
    provenance: "client-stated",
  });
});

test("metric extraction does not invent a confirmed baseline", () => {
  const partialLines = parseTranscriptText("[00:10] Morgan: It takes about 3 days.", { Morgan: "client" });
  const partialMetrics = extractMetrics(partialLines);
  assert.equal(partialMetrics[0].value, "3 days");
  assert.equal(baselineStatusFor(partialMetrics), "Partial");

  const confirmedLines = parseTranscriptText("[00:10] Morgan: We handle 20 bids each week.", { Morgan: "client" });
  assert.equal(baselineStatusFor(extractMetrics(confirmedLines)), "Confirmed");
});

test("call 1 synthesis remains provisional even with metrics", () => {
  const result = synthesizeTranscript(
    "[00:10] Morgan: We handle 20 bids each week.\n[00:30] Morgan: Approval takes 3 days and the queue waits for me.",
    { client: "Acme", callNumber: 1, humanOwner: { name: "Morgan", role: "Owner" }, speakerRoles: { Morgan: "client" } },
  );
  assert.equal(result.baselineStatus, "Confirmed");
  assert.equal(result.constraintCandidate.findingStatus, "provisional");
  assert.equal(result.constraintCandidate.constraintType, "latency");
  assert.equal(result.quotes[0].provenance, "client-stated");
});

test("an unmapped speaker is NOT assumed to be the client (fail closed)", () => {
  // A real advisor is named like a person. With no role map, their leading question must not
  // become a client-stated metric — the failure that voided grounding on the live path.
  const lines = parseTranscriptText("[00:10] Mike Roberson: So turnaround is about 3 days per quote, right?");
  assert.notEqual(lines[0].provenance, "client-stated");
  assert.equal(lines[0].provenance, "gap");
  assert.equal(extractMetrics(lines).length, 0, "no metric may be drawn from an unattributed speaker");

  // The same line, once the advisor tags that speaker as the client, does become evidence.
  const tagged = parseTranscriptText("[00:10] Mike Roberson: Turnaround is 9 days per quote.", { "Mike Roberson": "client" });
  assert.equal(tagged[0].provenance, "client-stated");
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
  // Two client lines and a bound baseline: the same bar the grounding layer applies before it
  // will build a constraint at all. One line used to be enough here, so a finding the evidence
  // layer would have refused could still be approved (audit F3/F4/F6).
  const result = synthesizeTranscript(
    [
      "[00:10] Morgan: We process 20 bids each week and the queue waits for my approval.",
      "[00:41] Morgan: Every bid sits 6 days per bid before I get to it, and nothing moves while I am away.",
    ].join("\n"),
    {
      client: "Acme",
      callNumber: 2,
      humanOwner: { name: "Morgan", role: "Owner" },
      speakerRoles: { Morgan: "client" },
    },
  );
  assert.ok(result.constraintCandidate);
  assert.ok(
    result.constraintCandidate.evidence.length >= 2,
    "the fixture must carry the two distinct client lines the bar now requires",
  );
  assert.notEqual(result.constraintCandidate.baselineMetric.source, "Missing");
  assert.doesNotThrow(() => requireDiagnosisApprovalEvidence(result.constraintCandidate));
  assert.throws(
    () => requireDiagnosisApprovalEvidence({
      ...result.constraintCandidate,
      humanOwner: { name: "", role: "" },
    }),
    /named human owner/,
  );
  // One quote, or the same quote twice, is not corroboration.
  assert.throws(
    () => requireDiagnosisApprovalEvidence({
      ...result.constraintCandidate,
      evidence: result.constraintCandidate.evidence.slice(0, 1),
    }),
    /at least 2 distinct client-stated quotes/,
  );
  const duplicated = result.constraintCandidate.evidence[0];
  assert.throws(
    () => requireDiagnosisApprovalEvidence({
      ...result.constraintCandidate,
      evidence: [duplicated, { ...duplicated }],
    }),
    /at least 2 distinct client-stated quotes/,
  );
  // A baseline the grounding layer recorded as Missing cannot be approved beside a finding
  // whose engagement column happens to read Confirmed.
  assert.throws(
    () => requireDiagnosisApprovalEvidence({
      ...result.constraintCandidate,
      baselineMetric: { name: "", value: "", unit: "", period: "", source: "Missing" },
    }),
    /baseline metric bound to the constraint/,
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

/* ===========================================================================
 * CLIENT PIPELINE — roster import, firmographics, and the gated audit invite
 * =========================================================================== */

test("a real Zoho Leads header row maps onto the roster fields", () => {
  // Verbatim column order from a Zoho Leads CSV export.
  const headers = [
    "Record Id", "Lead Owner", "Company", "First Name", "Last Name", "Title", "Email",
    "Phone", "Mobile", "Website", "Lead Status", "Industry", "No of Employees",
    "Annual Revenue", "Lead Source", "Street", "City",
  ];
  const mapping = mapCsvHeaders(headers);
  const byField = Object.fromEntries([...mapping].map(([index, field]) => [field, headers[index]]));
  assert.deepEqual(byField, {
    company: "Company",
    firstName: "First Name",
    lastName: "Last Name",
    contactRole: "Title",
    email: "Email",
    phone: "Phone",
    website: "Website",
    industry: "Industry",
    headcountBand: "No of Employees",
  });
  // "Mobile" also maps to phone, but "Phone" came first and a claimed field is never overwritten.
  assert.equal(mapping.has(headers.indexOf("Mobile")), false);
  // Nothing is guessed from a column with no alias.
  for (const ignored of ["Record Id", "Lead Owner", "Lead Status", "Annual Revenue", "Lead Source", "Street", "City"]) {
    assert.equal(mapping.has(headers.indexOf(ignored)), false, `${ignored} must not be mapped`);
  }

  // The Accounts export spells the same columns differently; both must land in the same place.
  const accounts = mapCsvHeaders(["Account Name", "No. of Employees", "Designation", "Email Address"]);
  assert.deepEqual([...accounts.values()], ["company", "headcountBand", "contactRole", "email"]);
});

test("employee counts become bands, and an unreadable count stays unstated", () => {
  assert.equal(headcountBandFromEmployees("1"), "1-9");
  assert.equal(headcountBandFromEmployees("9"), "1-9");
  assert.equal(headcountBandFromEmployees("10"), "10-49");
  assert.equal(headcountBandFromEmployees("49"), "10-49");
  assert.equal(headcountBandFromEmployees("50"), "50-249");
  assert.equal(headcountBandFromEmployees("249"), "50-249");
  assert.equal(headcountBandFromEmployees("250"), "250+");
  assert.equal(headcountBandFromEmployees("1,200"), "250+");
  assert.equal(headcountBandFromEmployees("500+"), "250+");
  // A band already written as a band is honoured as written.
  assert.equal(headcountBandFromEmployees("10-49"), "10-49");
  // A range asserts only its low end about the company.
  assert.equal(headcountBandFromEmployees("11-50"), "10-49");
  // Nothing readable means "not stated" — never the nearest band.
  for (const value of ["", "   ", "unknown", "0", "N/A", "-5"]) {
    assert.equal(headcountBandFromEmployees(value), "", `${JSON.stringify(value)} must not become a band`);
  }
});

test("CSV import skips company-less rows and updates duplicates instead of doubling them", () => {
  const existing = [client({ id: "cli_known", email: "maya@acme.example", industry: "", headcountBand: "", contactRole: "" })];
  const csv = [
    "Company,First Name,Last Name,Title,Email,Website,Industry,No of Employees",
    // Same company + email as the existing roster row: an update, not a second copy.
    'Acme Industrial,Maya,Chen,"Chief Operating Officer",maya@acme.example,https://acme.example,Manufacturing,120',
    // No company name at all.
    ",Sam,Ford,Owner,sam@nowhere.example,,Retail,4",
    // New client, and a quoted field containing a comma must not shift the later columns.
    'Borden Joinery,Ade,Okafor,"Director, Operations",ade@borden.example,borden.example,Construction & trades,7',
    // The same new client twice in one file collapses to one create, later values winning.
    "Borden Joinery,Ade,Okafor,Managing Director,ade@borden.example,borden.example,Construction & trades,7",
    // Same company name but a different address is a different person, so a separate client.
    "Acme Industrial,Ravi,Patel,CFO,ravi@acme.example,,,",
  ].join("\n");

  const plan = planClientImport(csv, existing);

  assert.equal(plan.summary.rowsRead, 5);
  assert.equal(plan.summary.imported, 2, "Borden Joinery once, plus the second Acme contact");
  assert.equal(plan.summary.updated, 1);
  assert.deepEqual(plan.summary.skipped, [{ line: 3, reason: "No company name in this row." }]);

  const borden = plan.creates.find((draft) => draft.company === "Borden Joinery");
  assert.equal(borden.contactName, "Ade Okafor");
  // Two rows for the same client: the later row's value wins, and the earlier quoted
  // "Director, Operations" proves its embedded comma did not shift the columns after it —
  // the email, website, industry, and employee count all still landed in the right fields.
  assert.equal(borden.contactRole, "Managing Director");
  assert.equal(borden.email, "ade@borden.example");
  assert.equal(borden.industry, "Construction & trades");
  assert.equal(borden.headcountBand, "1-9");
  assert.equal(borden.source, "csv");

  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "cli_known");
  assert.equal(plan.updates[0].patch.industry, "Manufacturing");
  assert.equal(plan.updates[0].patch.headcountBand, "50-249");
  // A blank column never erases a stored value: email is not in the patch at all.
  assert.equal("email" in plan.updates[0].patch, false);
});

test("CSV import reports the columns it ignored rather than guessing at them", () => {
  const plan = planClientImport("Company,Lead Score,Notes\nAcme,88,Called twice\n", []);
  assert.deepEqual(plan.summary.unmapped, ["Lead Score", "Notes"]);
  assert.deepEqual(plan.summary.mapped, [{ header: "Company", field: "company" }]);
  assert.equal(plan.creates[0].industry, "");
});

test("quoted CSV fields survive commas, newlines, and doubled quotes", () => {
  const rows = parseCsv('Company,Note\n"Acme, Inc.","He said ""go""\nthen left"\n');
  assert.deepEqual(rows, [
    ["Company", "Note"],
    ["Acme, Inc.", 'He said "go"\nthen left'],
  ]);
});

test("an audit invitation cannot be queued for a client with no email", () => {
  assert.throws(() => requireInvitableClient(client({ email: "" })), /no email address/);
  assert.throws(() => requireInvitableClient(client({ email: "   " })), /no email address/);
  assert.throws(() => requireInvitableClient(null), /Client not found/);
  assert.throws(() => requireInvitableClient(client({ company: "  " })), /no company name/);
  assert.equal(requireInvitableClient(client()).email, "maya@acme.example");
});

test("queueing an audit invitation composes the message and performs no external call", async () => {
  assert.ok(INTENT_TYPES.includes("audit_invite"), "audit_invite must be a reviewed intent type");

  // Any network call from the queue path is a failure: composing an invitation is offline work.
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error("the queue path must never contact an external provider");
  };
  let payload;
  try {
    payload = buildAuditInvitePayload(requireInvitableClient(client()), "Mike Roberson");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(calls, [], "no network call may happen while an invitation is queued");

  assert.equal(payload.to, "maya@acme.example");
  assert.equal(payload.clientId, "cli_one");
  assert.equal(payload.subject, "Throughput audit for Acme Industrial");
  // The payload is a proposal. It carries the explicit-approval marker every gated intent has,
  // and nothing in it can cause a send on its own.
  assert.equal(payload.requiresExplicitApproval, true);

  // A real plain-text part and a real HTML part, so the send never renders markdown as text.
  assert.match(payload.body, /^Hi Maya,/);
  assert.match(payload.body, /throughput audit/i);
  assert.match(payload.body, /I'll follow up shortly/);
  assert.match(payload.body, /Mike Roberson$/);
  assert.doesNotMatch(payload.body, /[*_#]{2}|^#{1,6} /m, "the text part must not be markdown");
  assert.match(payload.htmlBody, /<p>Hi Maya,<\/p>/);

  // No marketing, no invented claim, no tracking pixel, no link.
  for (const forbidden of [/<img/i, /http:\/\//i, /https:\/\//i, /<a\s/i, /unsubscribe/i, /guarantee/i, /% (?:more|faster|increase)/i]) {
    assert.doesNotMatch(payload.htmlBody, forbidden, `invitation HTML must not contain ${forbidden}`);
    assert.doesNotMatch(payload.body, forbidden, `invitation text must not contain ${forbidden}`);
  }

  // With no contact name the greeting degrades to a neutral one rather than inventing a name.
  const anonymous = buildAuditInviteEmail({ company: "Borden Joinery", contactName: "", advisorName: "" });
  assert.match(anonymous.text, /^Hello,/);
  assert.match(anonymous.text, /Tier 4 Advisor/);
});

test("firmographics are optional and an unrecognised value is never coerced to a real one", () => {
  assert.deepEqual(normalizeFirmographics(undefined), { industry: "", headcountBand: "", businessModel: "" });
  assert.deepEqual(
    normalizeFirmographics({ industry: "  Manufacturing  ", headcountBand: "50-249", businessModel: "services" }),
    { industry: "Manufacturing", headcountBand: "50-249", businessModel: "services" },
  );
  // A band or model the app does not recognise reads as "not stated", never as the nearest value.
  assert.deepEqual(
    normalizeFirmographics({ industry: 7, headcountBand: "42", businessModel: "consulting" }),
    { industry: "", headcountBand: "", businessModel: "" },
  );
  // Firmographics travel on the metadata PATCH path, and the protected-field guard still holds.
  assert.doesNotThrow(() => requirePatchCommand({
    command: "update_metadata",
    expectedVersion: 1,
    fields: { firmographics: { industry: "Retail & ecommerce", headcountBand: "10-49", businessModel: "retail" } },
  }));
  assert.throws(
    () => requirePatchCommand({ command: "update_metadata", expectedVersion: 1, fields: { findingStatus: "approved" } }),
    /protected field/,
  );
});
