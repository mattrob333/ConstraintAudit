import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { truncateQuote } from "../lib/canvas.ts";
import {
  DEFAULT_FOOTER_LINE,
  MAX_LOGO_BYTES,
  clientConstraintHeadline,
  formatDocumentDate,
  generateProposal,
  generateReadinessBrief,
  markdownToPlainText,
  measureLabel,
  prescriptionImplicatesSystem,
  renderDeliverableDocument,
  renderGoogleDocHtml,
  validateLogoDataUrl,
} from "../lib/deliverables.ts";
import { buildDemoEngagement, demoFinding } from "../lib/demo.ts";

const SEEDED_AT = "2026-06-26T11:00:00.000Z";
const engagement = buildDemoEngagement("own_letterhead", SEEDED_AT);
const finding = engagement.data.finding ?? demoFinding();

/** A one-pixel PNG, small enough to inline and real enough to validate. */
const LOGO = `data:image/png;base64,${Buffer.from("a-real-enough-png").toString("base64")}`;

const LETTERHEAD = {
  firmName: "Roberson & Co Advisory",
  advisorName: "Mike Roberson",
  addressLine: "18 Fulton Street, Suite 4, Columbus OH 43215",
  footerLine: DEFAULT_FOOTER_LINE,
  logoDataUrl: LOGO,
};

const META = {
  client: "Meridian Millwork",
  title: "Fixed-Sprint Proposal",
  advisor: "Tier 4 Advisor",
  date: "2026-07-29",
  confidential: true,
};

/* ------------------------------------------------------------------ *
 * The branded shell (C8)
 * ------------------------------------------------------------------ */

test("a printed document carries the firm's letterhead when one is configured", () => {
  const html = renderDeliverableDocument("# Meridian Millwork — Fixed-Sprint Proposal\n\nBody text.\n", {
    ...META,
    letterhead: LETTERHEAD,
  });

  // Logo top-left, capped at the width Drive's HTML->Doc conversion carries reliably.
  assert.match(html, /<img alt="Roberson &amp; Co Advisory" src="data:image\/png;base64,[^"]+" width="150" \/>/);
  // Firm and address right-aligned, in a table so the layout survives the Doc conversion.
  assert.match(html, /<td class="letterhead-firm" style="text-align:right"><strong>Roberson &amp; Co Advisory<\/strong><br \/>18 Fulton Street/);
  // One attribution line: for whom, by whom, when.
  assert.match(html, /Prepared for Meridian Millwork · Prepared by Mike Roberson, Roberson &amp; Co Advisory · 29 July 2026/);
  // The advisor's own confidentiality wording, at the foot.
  assert.ok(html.includes(`<div class="doc-footer">`));
  assert.ok(html.includes(DEFAULT_FOOTER_LINE));
  // Print rules the owner is relying on: a 2cm page margin, a repeating footer, no orphan heading.
  assert.match(html, /@page \{ margin: 20mm; \}/);
  assert.match(html, /\.doc-footer \{\s*position: fixed;/);
  assert.match(html, /break-after: avoid-page/);
  // The document's own H1 is dropped: the shell already printed the title.
  assert.equal(html.match(/<h1>/g).length, 1);
});

test("an advisor who has configured nothing still gets a clean document, never a broken header", () => {
  const html = renderDeliverableDocument("# Anything\n\nBody text.\n", { ...META, letterhead: null });
  const page = html.slice(html.indexOf("<main>"));

  assert.doesNotMatch(page, /<img/, "no logo means no image element at all");
  assert.doesNotMatch(page, /<table class="letterhead">/, "an unset letterhead must not print an empty band");
  assert.doesNotMatch(page, /undefined|\bnull\b|\[object Object\]/);
  // The parts that do not depend on configuration are all still there.
  assert.match(html, /Prepared for Meridian Millwork · Prepared by Tier 4 Advisor · 29 July 2026/);
  assert.ok(html.includes(DEFAULT_FOOTER_LINE), "the confidentiality line falls back to the default");
});

test("the Google Doc path receives the same letterhead and no stylesheet to lose", () => {
  const html = renderGoogleDocHtml("# Anything\n\n## A heading\n\nBody.\n", { ...META, letterhead: LETTERHEAD });

  assert.doesNotMatch(html, /<style>/, "Drive strips CSS, so this path must not depend on any");
  assert.match(html, /<table class="letterhead">/, "layout rides on table structure, which converts");
  assert.match(html, /<img alt="Roberson &amp; Co Advisory"[^>]*width="150"/);
  assert.match(html, /Prepared for Meridian Millwork · Prepared by Mike Roberson, Roberson &amp; Co Advisory/);
  assert.ok(html.includes(DEFAULT_FOOTER_LINE));
});

test("a letterhead value can never inject markup into a client document", () => {
  const html = renderDeliverableDocument("Body.", {
    ...META,
    client: "<script>alert(1)</script>",
    letterhead: { ...LETTERHEAD, firmName: `Ampersand & "quote" <b>`, logoDataUrl: `" onerror="alert(1)` },
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /onerror=/);
  // A value that does not validate as PNG/JPEG base64 is dropped rather than printed.
  assert.doesNotMatch(html, /<img/);
});

test("the documents route renders through the shell and hands it the letterhead", async () => {
  const route = await readFile(new URL("../app/api/documents/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /renderDeliverableDocument\(/);
  assert.doesNotMatch(route, /renderMarkdownToHtml/, "the body-only renderer is no longer the print path");
  assert.match(route, /letterhead: settings\.letterhead/);
  assert.match(route, /document\.created_at/, "a reprint must not re-date the document");
  assert.match(route, /confidential: true/);
});

test("the publish intent carries the letterhead into the Drive conversion", async () => {
  const actions = await readFile(new URL("../lib/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /letterhead: settings\.letterhead/, "the intent stores the letterhead as queued");
  assert.match(actions, /renderGoogleDocHtml\(markdown, \{[\s\S]*?letterhead,/);
});

/* ------------------------------------------------------------------ *
 * The signable proposal (C7)
 * ------------------------------------------------------------------ */

const proposal = generateProposal(engagement, finding, { issuedAt: "2026-07-29" });

test("the proposal has an acceptance block that can actually be signed", () => {
  assert.match(proposal, /^## Acceptance$/m);
  assert.match(proposal, /\*\*Date issued:\*\* 29 July 2026/);
  assert.match(proposal, /\*\*Valid until:\*\* 28 August 2026/, "thirty days from issue");
  assert.match(proposal, /\*\*Fee:\*\* \$2,500 USD, fixed/);
  assert.match(proposal, /\*\*Work starts when:\*\* Dana Whitfield \(Owner\) accepts this proposal in writing\./);
  assert.match(proposal, /stop the sprint at any Monday/);
  // Two parties, two signatures.
  assert.match(proposal, /\| For Meridian Millwork \| For Tier 4 Advisor \|/);
  assert.match(proposal, /\| Signature: \| Signature: \|/);
  // No invented commercial terms beyond what the record supports.
  for (const invented of [/deposit/i, /net \d+ days/i, /invoice[ds]? (?:monthly|weekly)/i, /governing law/i, /indemnif/i]) {
    assert.doesNotMatch(proposal, invented, `the proposal invented a term: ${invented}`);
  }
});

test("the proposal reads back only the figures that bear on the constraint", () => {
  // The baseline the whole diagnosis rests on has to survive the filter.
  assert.match(proposal, /9 days per quote/);
  // These are real lines from the practice call that have nothing to do with the constraint.
  // Printing them was C7(a): the website's age, an ex-employee's tenure, a two-week holiday.
  const section = proposal.slice(
    proposal.indexOf("## Your numbers, as you stated them"),
    proposal.indexOf("## Dream outcome"),
  );
  for (const noise of ["four years old", "seven months", "two weeks in July", "Twenty-two people"]) {
    assert.equal(section.includes(noise), false, `the unfiltered number dump leaked: ${noise}`);
  }
  assert.ok(section.split("\n").filter((line) => line.startsWith("- ")).length <= 10);
});

test("no figure is rendered malformed anywhere in the proposal", () => {
  for (const malformed of ["20% percent", "$25,000 dollars", "9 days quote", "requests month", "years years"]) {
    assert.equal(proposal.includes(malformed), false, `malformed figure in the proposal: ${malformed}`);
  }
  // Two words repeated back to back is what every one of those bugs looked like.
  const numbers = proposal.slice(
    proposal.indexOf("## Your numbers, as you stated them"),
    proposal.indexOf("## Dream outcome"),
  );
  assert.doesNotMatch(numbers, /\b(\w+)\s+\1\b/, "a unit was repeated in a client-facing line");
});

test("the three parts of a measure are composed the way a person would say them", () => {
  assert.equal(measureLabel("20%", "percent", ""), "20%");
  assert.equal(measureLabel("$25,000", "dollars", ""), "$25,000");
  assert.equal(measureLabel("9 days", "days", "quote"), "9 days per quote");
  assert.equal(measureLabel("30", "requests", "month"), "30 requests per month");
  assert.equal(measureLabel("four years", "years", ""), "four years");
  assert.equal(measureLabel("3", "days", "per quote"), "3 days per quote");
  assert.equal(measureLabel("", "days", "month"), "");
});

test("the measurement-clock sentence is a sentence", () => {
  const time = proposal.slice(proposal.indexOf("## Time"), proposal.indexOf("## Effort"));
  assert.doesNotMatch(time, /starts when [A-Z]/, "a capital letter mid-sentence");
  assert.doesNotMatch(time, /\.\./, "a doubled full stop");
  assert.match(time, /The baseline is already confirmed from Rosa Alvarez's log\./);
});

test("the static Likelihood line is gone and something answerable stands in its place", () => {
  assert.doesNotMatch(proposal, /^## Likelihood$/m);
  assert.match(proposal, /^## Whether this will work$/m);
  // The kill condition — the honest "here is how we would know we were wrong".
  assert.match(proposal, /### How we would know we were wrong/);
  assert.ok(proposal.includes(finding.killCondition));
  // The evidence chain, counted, with the people who said it.
  assert.match(proposal, /### What this rests on/);
  assert.match(proposal, /5 client-stated quotes on the record, from Dana Whitfield and Rosa Alvarez/);
  // The client's own arithmetic, explicitly not done for them.
  assert.match(proposal, /### Your numbers, your arithmetic — we project nothing/);
  assert.match(proposal, /\*\*How much work arrives:\*\* 30 requests per month/);
  assert.match(proposal, /\*\*How much of it you win:\*\* 20%/);
  assert.match(proposal, /deliberately not multiplied them together for you/);
});

test("the constraint headline a client reads is a sentence, not our enum", () => {
  assert.match(proposal, /\*\*The work waits on know-how that lives in one person's head\.\*\* It shows up in Key Activities\./);
  assert.doesNotMatch(
    proposal.slice(0, proposal.indexOf("## What you told us")),
    /knowledge constraint in/,
    "the raw enum led the document a client reads",
  );
  for (const type of ["capacity", "latency", "quality", "knowledge", "policy"]) {
    const headline = clientConstraintHeadline({ ...finding, constraintType: type });
    assert.doesNotMatch(headline, new RegExp(`\\b${type} constraint\\b`), `${type} has no plain sentence`);
    assert.match(headline, /^\*\*[A-Z][^*]+\.\*\* It shows up in /);
  }
});

test("the advisor-facing surfaces keep the enum they need", async () => {
  const deliverables = await readFile(new URL("../lib/deliverables.ts", import.meta.url), "utf8");
  const spec = deliverables.slice(deliverables.indexOf("export function generateDeveloperSpec"));
  assert.match(spec.slice(0, 2000), /\$\{finding\.constraintType\} constraint in/);
});

/* ------------------------------------------------------------------ *
 * The small dignity fixes (C9, C14, C15, C18, C22)
 * ------------------------------------------------------------------ */

test("a shortened client quote never stops in the middle of a word", () => {
  const long = "We promised the GC a number by Friday and then the whole thing sat on my desk because I was on site all week, and by the time I finally got to it the bid date had already gone past us and the general contractor had simply stopped waiting for it entirely, which is not the first time that has happened here.";
  const cut = truncateQuote(long);
  assert.ok(cut.length <= 240);
  assert.ok(cut.endsWith("…"), "a shortened quote has to say that it was shortened");
  const lastWord = cut.slice(0, -1).trim().split(/\s+/).pop();
  assert.ok(long.split(/\s+/).includes(lastWord), `truncation cut mid-word: ended on "${lastWord}"`);
  assert.doesNotMatch(cut, /[\s,;:.!?—–-]…$/, "punctuation left dangling before the ellipsis");
  // A quote that fits is returned exactly as it was said, with no marker.
  assert.equal(truncateQuote("Short enough."), "Short enough.");
  assert.equal(truncateQuote(undefined), "");
  // Every length around the boundary stays intact and word-safe.
  for (let length = 235; length <= 260; length += 1) {
    const cutN = truncateQuote(long.slice(0, length));
    assert.ok(cutN.length <= 240, `overlong at input length ${length}`);
    assert.doesNotMatch(cutN, /\S…\S/);
  }
});

test("the readiness brief is written to a person, not to a company record", () => {
  const brief = generateReadinessBrief(engagement, {
    advisorName: "Mike Roberson",
    firmName: "Roberson & Co Advisory",
  });
  assert.match(brief, /Prepared for Dana Whitfield at Meridian Millwork by Mike Roberson, Roberson & Co Advisory\./);
  assert.match(brief, /Scheduled: 12 May 2026 at 14:00 UTC\./, "the booked call date is interpolated");
  assert.match(brief, /^## What we want to understand$/m);
  // Research-derived, and unmistakably questions rather than claims about their business.
  const section = brief.slice(brief.indexOf("## What we want to understand"), brief.indexOf("## Who should attend"));
  const lines = section.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(lines.length, 2, "up to two lines, and this engagement has two");
  for (const line of lines) assert.ok(line.trim().endsWith("?"), `not phrased as a question: ${line}`);
  assert.match(section, /questions, not conclusions/);
  assert.match(lines[0], /Your contact page says quotes come back within 48 hours/);
});

test("the readiness brief degrades gracefully with no research and no letterhead", () => {
  const bare = generateReadinessBrief(
    { ...engagement, primaryContact: "", call1At: null, data: { ...engagement.data, research: undefined } },
    {},
  );
  assert.match(bare, /Prepared for Meridian Millwork by Tier 4 Advisor\./);
  assert.doesNotMatch(bare, /What we want to understand/);
  assert.doesNotMatch(bare, /undefined|\bnull\b/);
  assert.match(bare, /- When: To be confirmed/);
});

test("the client-facing roles map never calls a named employee's work grind", async () => {
  const deliverables = await readFile(new URL("../lib/deliverables.ts", import.meta.url), "utf8");
  const map = deliverables.slice(deliverables.indexOf("const WORK_TYPE"), deliverables.indexOf("function workType"));
  assert.match(map, /judgment: "judgment-led/);
  assert.match(map, /grind: "repeatable/);
  assert.doesNotMatch(map, /"grind —/, "the internal word reached the client-facing label");
  // The stored enum is untouched: only the rendering changed.
  assert.match(map, /^\s+grind: /m);
});

test("a paper-and-people prescription produces no developer specification", () => {
  assert.equal(
    prescriptionImplicatesSystem(engagement, finding),
    false,
    "the practice prescription is a written price book — there is nothing for a developer to build",
  );
  // The "smallest intervention" argument lists the systems the change deliberately avoids.
  // Reading those as requirements is exactly the bug.
  assert.match(finding.prescription.whySmallestIntervention, /buys no software, and changes no system/);

  const buildable = {
    ...finding,
    prescription: { ...finding.prescription, description: "Build a small intake app that writes each enquiry into the CRM automatically." },
  };
  assert.equal(prescriptionImplicatesSystem(engagement, buildable), true);
  // A sprint task can also implicate a system even when the prescription does not.
  const viaTasks = { ...engagement, data: { ...engagement.data, sprint: { tasks: [{ task: "Wire the Zapier integration into the quote log." }] } } };
  assert.equal(prescriptionImplicatesSystem(viaTasks, finding), true);
});

test("the deliverable suite omits the developer spec rather than emptying it", async () => {
  const actions = await readFile(new URL("../lib/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /prescriptionImplicatesSystem\(engagement, finding\)/);
  assert.match(actions, /buildable\s*\n?\s*\?\s*\[\["developer_spec"/);
  const cockpit = await readFile(new URL("../app/components/AdvisorCockpit.tsx", import.meta.url), "utf8");
  assert.match(cockpit, /specOmitted && kind === "developer_spec"/, "the card goes with the artifact");
});

test("the readiness-brief email sends readable text, not markdown source", async () => {
  const actions = await readFile(new URL("../lib/actions.ts", import.meta.url), "utf8");
  const send = actions.slice(actions.indexOf(`if (type === "readiness_brief_send")`), actions.indexOf(`if (type === "audit_invite")`));
  assert.match(send, /markdownBody: markdownToPlainText\(brief\)/);
  assert.match(send, /htmlBody: markdownToHtml\(brief\)/, "the HTML part still comes from the markdown");

  const plain = markdownToPlainText(generateReadinessBrief(engagement, { advisorName: "Mike Roberson" }));
  assert.doesNotMatch(plain, /^#{1,6} /m, "heading hashes reached the plain-text body");
  assert.doesNotMatch(plain, /\*\*|__|`/, "emphasis and code syntax reached the plain-text body");
  assert.match(plain, /^What the session is$/m, "the heading survived as a line of text");
  assert.match(plain, /^- Monthly volumes/m, "list structure survived");
  // A table becomes readable prose rather than a row of pipes.
  assert.equal(markdownToPlainText("| a | b |\n| --- | --- |\n| 1 | 2 |"), "a — b\n1 — 2");
  assert.equal(markdownToPlainText("See [the log](https://example.com/log)."), "See the log (https://example.com/log).");
});

/* ------------------------------------------------------------------ *
 * Letterhead storage rules
 * ------------------------------------------------------------------ */

test("an uploaded logo is checked before it can reach a client document", () => {
  assert.deepEqual(validateLogoDataUrl(""), { ok: true, dataUrl: "" });
  assert.deepEqual(validateLogoDataUrl(LOGO), { ok: true, dataUrl: LOGO });

  const gif = `data:image/gif;base64,${Buffer.from("gif").toString("base64")}`;
  const wrongType = validateLogoDataUrl(gif);
  assert.equal(wrongType.ok, false);
  assert.match(wrongType.message, /not a PNG or JPEG/);
  assert.doesNotMatch(wrongType.message, /base64|mime|regex/i, "the message is for an advisor, not a log file");

  const huge = `data:image/png;base64,${"A".repeat(Math.ceil((MAX_LOGO_BYTES + 4096) * 4 / 3))}`;
  const tooBig = validateLogoDataUrl(huge);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.message, /KB\. The limit is 200 KB/);

  for (const junk of ["not-a-url", "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4="]) {
    assert.equal(validateLogoDataUrl(junk).ok, false, `accepted junk: ${String(junk)}`);
  }
  // A non-string is not a bad logo, it is no logo: the advisor never uploaded one.
  for (const absent of [null, undefined, 42]) {
    assert.deepEqual(validateLogoDataUrl(absent), { ok: true, dataUrl: "" });
  }
});

test("the settings route refuses a bad logo with the plain reason", async () => {
  const route = await readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8");
  assert.match(route, /validateLogoDataUrl\(logo\)/);
  assert.match(route, /throw new HttpError\(400, checked\.message\)/);
});

test("a document date is readable and never locale-dependent", () => {
  assert.equal(formatDocumentDate("2026-07-29T11:04:00.000Z"), "29 July 2026");
  assert.equal(formatDocumentDate("2026-01-05"), "5 January 2026");
  assert.equal(formatDocumentDate(""), "");
  assert.equal(formatDocumentDate("not a date"), "not a date");
});
