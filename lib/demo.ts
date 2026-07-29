/**
 * Practice mode — one complete, entirely fictional engagement.
 *
 * An advisor can walk this end to end before they ever touch a real client, and it is the
 * demo shown to advisors who are nervous about running the audit live. Everything here is
 * invented: Meridian Millwork does not exist, nobody named in it exists, every address is
 * `@example.com` and every URL is under a reserved example domain.
 *
 * Rules this file keeps, because advisors learn the product's norms from the demo:
 *
 * - Pure and deterministic. No I/O, no network, no database, no `crypto.randomUUID()`,
 *   no `Date.now()` and no `new Date()`. Two advisors opening Practice mode see byte-identical
 *   content, it costs nothing, and it works with zero API keys configured.
 * - Every id is fixed (`eng_demo_practice`, `src_demo_*`, `con_demo_*`, ...).
 * - Research facts are `public-research`. Client claims are `client-stated` and carry the
 *   speaker and timestamp of the line they came from.
 * - The advisor's own lines are never evidence. Every "Advisor" line in the transcripts
 *   parses as `advisor-note`, which is the point: the demo visibly shows the tool refusing
 *   to treat the advisor's words as client evidence.
 * - Every number in the finding, the sprint, and the documents is traceable to a client
 *   line in one of the two transcripts below.
 */

import { applyCanvasUpdates, buildCanvasFromResearch, type Canvas } from "./canvas";
import {
  generateAuditReport,
  generateCatalogEntry,
  generateDeveloperSpec,
  generateDiagnosisPackage,
  generateFindingsAgenda,
  generateOutcomeReport,
  generateProposal,
  generateReadinessBrief,
  generateRoadmap,
  generateRolesMap,
  generateSprintPlan,
} from "./deliverables";
import { inferMetricDirection } from "./metric-direction";
import {
  rejectedHypothesisAppendixItem,
  type RejectedHypothesis,
} from "./openai-transcript-schema";
import { baselineStatusFor, extractMetrics, parseTranscriptText } from "./transcript";
import {
  computeMetricDelta,
  type BaselineMetric,
  type CanvasUpdate,
  type CatalogEntry,
  type ConstraintFinding,
  type ConstraintHypothesis,
  type DiscoveryQuestion,
  type Engagement,
  type EvidenceClaim,
  type OutcomeMeasurement,
  type ResearchSynthesis,
  type RoleMapEntry,
  type SourceEntry,
  type SprintRecord,
  type TranscriptLine,
  type TranscriptSynthesis,
  type ValueFlowStep,
} from "./workflow";

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

export const DEMO_ENGAGEMENT_ID = "eng_demo_practice";

/**
 * How a practice record is marked wherever a human or a query can see it: in the notes,
 * in the engagement folder, and in `data.practiceMode`. Anything carrying this marker is
 * training material and may never be sent to a client.
 */
export const DEMO_OWNER_MARKER = "PRACTICE MODE — fictional training data, never send to a client";

export const DEMO_CLIENT_NAME = "Meridian Millwork";
export const DEMO_WEBSITE = "https://meridian-millwork.example.com";
export const DEMO_CONTACT_EMAIL = "dana.whitfield@example.com";

/**
 * Engagement ids are a primary key, so a shared `eng_demo_practice` row could only ever
 * belong to one advisor. Each advisor gets their own deterministic copy, derived from the
 * owner id — same input, same id, forever, and no randomness anywhere.
 */
export function demoEngagementIdFor(ownerId: string): string {
  const suffix = (ownerId ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
  return suffix ? `${DEMO_ENGAGEMENT_ID}_${suffix}` : DEMO_ENGAGEMENT_ID;
}

/** True for the canonical practice id and for any advisor's own copy of it. */
export function isDemoEngagement(id: string): boolean {
  const value = (id ?? "").trim();
  return value === DEMO_ENGAGEMENT_ID || value.startsWith(`${DEMO_ENGAGEMENT_ID}_`);
}

/**
 * Speaker roles for the two transcripts. "Advisor" already resolves to `advisor-note` by
 * name, but stating it is the honest default: nothing in a transcript is client evidence
 * because the parser guessed correctly.
 */
export function demoSpeakerRoles(): Record<string, "client" | "advisor" | "unknown"> {
  return {
    Advisor: "advisor",
    "Dana Whitfield": "client",
    "Rosa Alvarez": "client",
    "Terry Nakamura": "client",
  };
}

/* ------------------------------------------------------------------ *
 * Dates
 *
 * The story has its own fixed calendar so the arc reads the same for everybody. Only the
 * record's own `createdAt`/`updatedAt` use the caller's `now`.
 * ------------------------------------------------------------------ */

const RESEARCH_AT = "2026-05-04T13:20:00.000Z";
const BRIEF_APPROVED_AT = "2026-05-06T15:00:00.000Z";
const BRIEF_SENT_AT = "2026-05-06T15:40:00.000Z";
const CALL_1_AT = "2026-05-12T14:00:00.000Z";
const CALL_2_AT = "2026-05-26T14:00:00.000Z";
const DIAGNOSIS_AT = "2026-05-27T16:10:00.000Z";
const SPRINT_AT = "2026-05-28T13:05:00.000Z";
const MEASURED_AT = "2026-06-25T15:30:00.000Z";
const CATALOG_AT = "2026-06-26T11:00:00.000Z";

const DEMO_ADVISOR = "Tier 4 Advisor";

/**
 * The arc's own dates, in order. Exported so seeded activity rows can be stamped with the
 * date the step happened in the story rather than the moment the record was created.
 */
export const DEMO_TIMELINE = {
  research: RESEARCH_AT,
  readinessBriefApproved: BRIEF_APPROVED_AT,
  readinessBriefSent: BRIEF_SENT_AT,
  call1: CALL_1_AT,
  call2: CALL_2_AT,
  diagnosisApproved: DIAGNOSIS_AT,
  sprintActivated: SPRINT_AT,
  outcomeMeasured: MEASURED_AT,
  catalogWritten: CATALOG_AT,
} as const;

/* ------------------------------------------------------------------ *
 * Transcripts
 *
 * Two recorded calls, written to be read. Format is `[MM:SS] Speaker: text` so
 * `parseTranscriptText` accepts every line; no line is left unattributed.
 * ------------------------------------------------------------------ */

const CALL_1 = `[00:00] Advisor: Before anything else — is it all right with both of you if I record and transcribe this? I would rather quote you accurately later than paraphrase you.
[00:11] Dana Whitfield: Fine by me. Rosa?
[00:14] Rosa Alvarez: Yeah, that is fine.
[00:17] Advisor: Thank you. I have read your website and drafted a map of how work moves through the shop. I expect parts of it to be wrong. The wrong parts are the useful ones.
[00:33] Dana Whitfield: Um, fair warning, that website is about four years old.
[00:41] Advisor: That is already useful. Start me at the front — where does a job come from?
[00:52] Dana Whitfield: General contractors, mostly. Commercial interiors. They are building out a clinic or a bank branch or a coffee shop, and the millwork package comes to us to price. Once in a while an architect specs us by name, which is nice, but the GC still has to send it over.
[01:20] Advisor: How does it physically reach you?
[01:26] Rosa Alvarez: Email. Nearly always email. There is a form on the website, but I think we have had three of those all year. It is an estimator sending a drawing set and a bid date.
[01:47] Dana Whitfield: And the bid date is always yesterday. They will email on a Tuesday saying bids are due Thursday.
[02:00] Advisor: How many of those land in a month?
[02:05] Dana Whitfield: A lot. Rosa, what are we at?
[02:10] Rosa Alvarez: We get about 30 requests a month. It has been around there since February, maybe a little higher.
[02:24] Advisor: And what happens to one when it lands?
[02:30] Rosa Alvarez: I log it on the whiteboard — GC, job name, bid date — and I drop the drawings into the job folder on the server. Then it waits for Dana.
[02:49] Advisor: It waits for Dana.
[02:53] Rosa Alvarez: It waits for Dana. Sorry, Dana.
[02:58] Dana Whitfield: No, that is — yeah. That is accurate.
[03:04] Advisor: Say more about that. Who prices a job?
[03:11] Dana Whitfield: I do. I price every quote that leaves this building. Every one.
[03:20] Advisor: Is there anybody else who can?
[03:25] Dana Whitfield: Nobody else here can price a job. It is not that they are not smart. The pricing is in my head. I have been doing takeoffs on this stuff for nineteen years. I know what a curved reception desk in solid surface is going to fight us on. Priya could do the takeoff, the quantities, all of that. The number at the bottom is mine.
[04:05] Advisor: How long does the pricing itself take you? Rough is fine.
[04:13] Dana Whitfield: Um. The actual pricing, an hour. Two if it is ugly.
[04:22] Advisor: And from the email arriving to the quote going back?
[04:29] Dana Whitfield: Four, five days? Call it a week when we are busy.
[04:37] Rosa Alvarez: It is longer than that.
[04:40] Dana Whitfield: Is it?
[04:43] Rosa Alvarez: I pulled the log in January because the Brightwater estimator was complaining. It is more like 9 days per quote. That is the average from the day I log it to the day it goes out.
[05:05] Dana Whitfield: Nine.
[05:08] Rosa Alvarez: Nine. Some go out in two days. Some of them sat three weeks.
[05:18] Dana Whitfield: Okay. That is worse than I would have said out loud.
[05:27] Advisor: That is the useful kind of wrong. What is happening during those nine days?
[05:36] Dana Whitfield: I am in the shop. Or I am at a site walk, or I am on the phone with a GC about a job we already have. The quoting happens at night mostly, or on a Sunday. It is the thing that gets pushed.
[06:02] Advisor: Does the contractor wait for you?
[06:08] Rosa Alvarez: Not always, and that is the part that bothers me. Half the time, by the time we send it, they already have two other numbers.
[06:24] Dana Whitfield: We lose on speed. I know we do. A lot of these GCs will take the first reasonable number from a shop they trust. We are the shop they trust. We are just not first.
[06:47] Advisor: Do you know what you are winning?
[06:53] Rosa Alvarez: I track it in the spreadsheet. We are winning about 20 percent of what we quote.
[07:04] Dana Whitfield: It used to be a third. Easily a third, four or five years ago.
[07:13] Advisor: Has anything changed on your side since then?
[07:20] Dana Whitfield: We got bigger. Twenty-two people now, we were fourteen. More work in the shop means less of me at a desk. And the router — we bought the CNC in 2022 and it changed what we could take on, so people started asking us for bigger packages. Which is good. A bigger package is a longer takeoff.
[07:56] Dana Whitfield: Actually, that router. Let me tell you what nobody tells you about buying a CNC. Everybody sells you on the cutting. Nobody tells you that you need somebody who can run the nesting software, and that person does not exist in this county. We had a kid from the tech school, he was terrific, he left for a boat builder up in Sandusky. Terry taught himself off YouTube. Genuinely, YouTube, at his kitchen table.
[08:41] Advisor: How much of Terry's week is nesting now?
[08:48] Dana Whitfield: Not much, he has it down to nothing. Sorry. You asked about quoting.
[08:58] Advisor: It is related, and I will come back to it. Let me walk the rest of the flow and you tell me where I have it wrong. An enquiry comes in, you price it, the GC awards it. Then what?
[09:19] Dana Whitfield: Then shop drawings. That is Priya. She draws the package, it goes to the architect, they mark it up, we revise, they approve. Two rounds usually. Three if the architect is precious about reveals.
[09:47] Advisor: And that starts only after the award?
[09:53] Dana Whitfield: It has to. We are not drawing a job we have not got.
[10:00] Advisor: Then fabrication.
[10:05] Dana Whitfield: Then Terry schedules it into the shop. Materials get ordered off the approved drawings, that is Rosa, and it goes up on the whiteboard by install date.
[10:24] Rosa Alvarez: Which is its own conversation.
[10:28] Advisor: Noted. And install?
[10:33] Dana Whitfield: Miles and two guys. Three if it is a big fixture package. They load out, they set it, they punch it, and we are done.
[10:48] Advisor: Where do the materials come from?
[10:56] Rosa Alvarez: Sheet goods come from Kepler Supply out of Toledo. Hardware is Grainhouse. The difficult finishes we sub out to Alder Coatings across town, because we do not spray conversion varnish here anymore.
[11:20] Advisor: And how does the money work — is it all project work?
[11:28] Dana Whitfield: All of it. Fixed-price contract work, billed by progress. There is no service side, no maintenance, nothing recurring. We install it and we are done until the next build-out.
[11:50] Advisor: Where does the money go?
[11:55] Dana Whitfield: Payroll. Payroll is the whole thing, shop labor and the lease on this building. Material is more or less a pass-through, I mark it up, but payroll is what decides whether the year works.
[12:18] Advisor: Who does the customer actually deal with?
[12:24] Dana Whitfield: Me. Every GC we work for has my mobile number.
[12:31] Rosa Alvarez: And they use it. All day.
[12:36] Advisor: If I asked you which of those steps is the one hurting you, what would you say?
[12:45] Dana Whitfield: Quoting. It is quoting. I have known that for two years.
[12:54] Advisor: What have you tried?
[13:00] Dana Whitfield: I hired an estimator in 2023. He lasted seven months. He would give me a number and I would change it, and eventually he told me I did not want an estimator, I wanted a typist. He was not wrong.
[13:26] Advisor: Why did you change his numbers?
[13:32] Dana Whitfield: Because he priced the drawing. He did not price the job. There is a difference. A wall of upper cabinets in a fire station is not the same as a wall of upper cabinets in a law firm, and that is not in the drawing. That is knowing who will be standing over you when it goes in.
[14:04] Advisor: So the judgment is real. Is all of it judgment?
[14:12] Dana Whitfield: No. If I am honest, no. A lot of it is the same thing over and over. Base cabinets are base cabinets.
[14:26] Advisor: Hold that thought. I want to come back to it next time with your numbers in front of us. Who else touches a quote before it goes out?
[14:41] Rosa Alvarez: Nobody. Dana writes the number on the takeoff, I put it on our form and email it out.
[14:54] Advisor: Does anyone approve it?
[15:00] Dana Whitfield: I am the approval. There is nobody above me, which is sort of the problem.
[15:12] Advisor: What happens when you are away?
[15:18] Dana Whitfield: We do not quote. We were up in Michigan for two weeks in July and Rosa had a stack waiting for me when I got back.
[15:33] Rosa Alvarez: Eleven of them.
[15:36] Dana Whitfield: Eleven. And two of those had bid dates that had already passed.
[15:47] Advisor: Where do the numbers live? Is there a system?
[15:55] Rosa Alvarez: Takeoffs are in Excel, one workbook per job. The log is a Google Sheet that I keep. Invoicing is QuickBooks. The whiteboard is the whiteboard.
[16:15] Advisor: Is the whiteboard the real schedule?
[16:20] Rosa Alvarez: The whiteboard is the real schedule. Everything else is a record of what the whiteboard said.
[16:32] Advisor: Last question. If quotes went out in two days instead of nine, what breaks?
[16:43] Dana Whitfield: Um. We would win more, and then — yeah. Drawings. Priya already has a queue. If we win more work we are going to jam up at shop drawings, I would bet money on it.
[17:05] Advisor: Good. I want that on the record, because if we fix quoting that is probably where this moves next.
[17:16] Dana Whitfield: Then at least it would be a good problem.
[17:22] Advisor: Here is what I will do. I will put what Rosa's log says next to what you have told me, and come back with one constraint and one thing to change. Not a list. One.
[17:40] Dana Whitfield: I will send you the log. Rosa, can you pull the last six months out of the sheet for him?
[17:51] Rosa Alvarez: I will send it over tomorrow morning.
[17:56] Advisor: Thank you. And Dana, one piece of homework before we speak again — think about which parts of a quote you would genuinely not need to see.
[18:11] Dana Whitfield: That is a harder question than it sounds.
[18:16] Advisor: It is the whole job.`;

const CALL_2 = `[00:00] Advisor: Same question as last time — all right if I record?
[00:06] Dana Whitfield: Yes. Terry is here as well, I asked him to sit in for the second half.
[00:14] Terry Nakamura: Hey.
[00:16] Advisor: Good, I want him for the last stretch anyway. Here is how this goes. I am going to tell you what I heard, in your words, and I want you to stop me the moment something is wrong. It is six pages and the first page is nothing but quotes from you.
[00:39] Dana Whitfield: Okay.
[00:42] Advisor: Start with the number, because everything else hangs off it. Rosa's log says nine days from the day an enquiry is logged to the day the quote goes out. Is that a number you would stand behind in front of a customer?
[01:02] Dana Whitfield: I went back through the sheet myself after we talked. It is 9 days per quote, yes. I wanted it to be wrong and it is not.
[01:18] Advisor: Thank you. Second, the constraint as I have written it. Every quote in this business waits on you, personally, to price it. The pricing step is not slow. The queue in front of it is.
[01:38] Dana Whitfield: That is it. That is exactly it. The hour of work is not the problem. It is the eight days it sits before I get to the hour.
[01:53] Advisor: And I am calling that a knowledge dependency rather than a capacity problem, because hiring another pair of hands did not fix it in 2023.
[02:06] Dana Whitfield: No, and I would have told you it was capacity. It is not. The thing that makes the number is in my head and nowhere else.
[02:24] Advisor: Before we go on, there is one thing on page three I have wrong and I want you to correct it on the record. I had Priya drawing the whole package after award.
[02:40] Dana Whitfield: She does not. That is my fault, I said it badly last time. Priya does the casework drawings. Terry does the fixture drawings, the display work, anything going into a store rollout. It is maybe sixty-forty.
[03:03] Terry Nakamura: More like seventy-thirty in the fall.
[03:08] Dana Whitfield: In the fall, sure.
[03:12] Advisor: That matters, so let me say it back to you. When I predict that the next thing to jam is shop drawings, that is not one person's queue. It is two people who both already have another job.
[03:30] Terry Nakamura: I am on the floor all day. My drawings happen after five.
[03:38] Advisor: Understood. Now the prescription, and I want to be honest that it is smaller than you are expecting. You do not stop pricing. You price the assemblies instead of the jobs — once, up front, in a book you write yourself. Anything a quote is made of that the book covers, Rosa sends the same day without you. Anything outside the book still comes back to you for quote pricing.
[04:10] Dana Whitfield: A price book.
[04:13] Advisor: A price book that is yours, that you can change any Monday you like.
[04:21] Dana Whitfield: Um. Okay. Let me think about whether that covers anything real.
[04:31] Dana Whitfield: If I am honest, six or seven assemblies cover most of what we quote. Base runs, uppers, a reception desk, a transaction counter, slat wall, a nurses station. That is the bulk of it.
[04:53] Advisor: That is the whole idea. How do you want the exception to work?
[05:01] Dana Whitfield: Anything over about $25,000 I want to price myself. And anything in solid surface, I do not care what it costs, that material will eat you alive if you are not careful.
[05:20] Advisor: Good. Who owns the number when it is wrong?
[05:27] Dana Whitfield: Me. It is my book. If Rosa sends out a bad number off my book, that is mine, not hers, and she needs to hear me say that.
[05:43] Advisor: She will — it is written down as yours in the pack. What about the log? Rosa has to keep logging exactly the way she does now, or the before and after do not compare.
[05:59] Terry Nakamura: You will want to tell her before anybody changes that form.
[06:06] Dana Whitfield: Nobody is touching the form. Date in, date out, same sheet.
[06:14] Advisor: How long before we look at whether it worked?
[06:21] Dana Whitfield: Four weeks. I can give you four weeks before the Q3 work lands.
[06:31] Advisor: And what would tell us I am wrong — that pricing was never the constraint?
[06:40] Dana Whitfield: If quotes go out in three days and we still do not win any more of them. Then it was never speed, it was my price, and that is a different conversation.
[06:58] Advisor: I am going to write that down as the stop condition in your words, because in four weeks one of us will be tempted to explain it away.
[07:12] Dana Whitfield: Probably me.
[07:18] Advisor: Terry, this is where I want you. If quoting goes from nine days to three, and the win rate moves at all, what is the first thing that hurts?
[07:34] Terry Nakamura: Drawings. Same as Dana said. There is no version of more work where drawings do not back up first, because approvals are not in our control. The architect sits on it for a week and we cannot start cutting.
[07:56] Advisor: So the next constraint is probably drawing capacity plus approval latency, and it is not the one we are fixing this month.
[08:08] Dana Whitfield: I would rather have that problem than this one.
[08:15] Advisor: Agreed, and I want it named in the pack, so that when it shows up in five weeks nobody thinks the sprint failed. That is what a constraint moving looks like.
[08:31] Dana Whitfield: Okay. So what do you need from me.
[08:37] Advisor: Two evenings. One to write the book with me, one to sit with Rosa while she uses it on the first three enquiries that come in.
[08:50] Dana Whitfield: I can do next Tuesday and the Thursday after.
[09:02] Advisor: Then the last thing is the boring one. Nothing here goes to a customer, nothing gets sent anywhere, until you have read it. Everything I write for you is a draft until you say otherwise.
[09:18] Dana Whitfield: Understood.
[09:21] Advisor: I will get the pack over to you tonight and we start on the book Tuesday.
[09:30] Dana Whitfield: Alright. And thank you for not bringing me a list of forty things.
[09:38] Advisor: There is only ever one thing that is the limit at a time. Everything else is a distraction that costs money.`;

export function demoTranscript(callNumber: 1 | 2): string {
  return callNumber === 1 ? CALL_1 : CALL_2;
}

function demoLines(callNumber: 1 | 2): TranscriptLine[] {
  return parseTranscriptText(demoTranscript(callNumber), demoSpeakerRoles());
}

/** Same shape `synthesizeTranscript` records, so the demo's speaker panel is not a special case. */
function speakerSummary(lines: TranscriptLine[]): NonNullable<TranscriptSynthesis["speakerSummary"]> {
  const counts = new Map<string, { lines: number; provenance: TranscriptLine["provenance"] }>();
  for (const line of lines) {
    const existing = counts.get(line.speaker);
    if (existing) existing.lines += 1;
    else counts.set(line.speaker, { lines: 1, provenance: line.provenance });
  }
  return Array.from(counts.entries()).map(([speaker, entry]) => ({
    speaker,
    lines: entry.lines,
    provenance: entry.provenance,
  }));
}

/* ------------------------------------------------------------------ *
 * Public research
 * ------------------------------------------------------------------ */

const SITE = DEMO_WEBSITE;
const DIRECTORY_URL = "https://directory.example.org/listings/meridian-millwork";

function fact(
  statement: string,
  canvasBlock: string,
  sourceLabel: string,
  sourceUrl: string,
  confidence: number,
): EvidenceClaim {
  return { statement, provenance: "public-research", confidence, sourceLabel, sourceUrl, canvasBlock };
}

function demoResearchFacts(): EvidenceClaim[] {
  return [
    fact(
      "The company describes itself as an architectural millwork shop building custom casework and store fixtures for commercial interior contractors.",
      "Value Propositions",
      "Meridian Millwork — home page description",
      `${SITE}/`,
      0.8,
    ),
    fact(
      "The markets page names general contractors, retail rollout programs, healthcare interiors and financial branch build-outs as the buyers served.",
      "Customer Segments",
      "Meridian Millwork — markets page",
      `${SITE}/markets`,
      0.75,
    ),
    fact(
      "The contact page offers a request-a-quote form and a single estimating email address as the ways to submit work.",
      "Channels",
      "Meridian Millwork — contact page",
      `${SITE}/contact`,
      0.7,
    ),
    fact(
      "The contact page states that quotes are returned within 48 hours.",
      "Value Propositions",
      "Meridian Millwork — contact page",
      `${SITE}/contact`,
      0.6,
    ),
    fact(
      "The services page states that shop drawings are produced in-house and submitted to the architect for approval before fabrication.",
      "Key Activities",
      "Meridian Millwork — services page",
      `${SITE}/services`,
      0.7,
    ),
    fact(
      "The shop page lists a CNC router, an edgebander and a finishing room at a single location.",
      "Key Resources",
      "Meridian Millwork — shop page",
      `${SITE}/shop`,
      0.65,
    ),
    fact(
      "A trade directory listing records the company at 22 employees at one location in Ohio.",
      "Key Resources",
      "Commercial Interiors Trade Register — listing",
      DIRECTORY_URL,
      0.6,
    ),
    fact(
      "Project pages describe fixed-price package work for named build-outs; no recurring service, maintenance or warranty offering is described anywhere on the site.",
      "Revenue Streams",
      "Meridian Millwork — projects index",
      `${SITE}/projects`,
      0.55,
    ),
    fact(
      "The about page names Dana Whitfield as owner and gives her as the only named contact for estimating enquiries.",
      "Customer Relationships",
      "Meridian Millwork — about page",
      `${SITE}/about`,
      0.7,
    ),
    fact(
      "The suppliers strip names a sheet-goods distributor and a hardware distributor; no finishing partner is named.",
      "Key Partners",
      "Meridian Millwork — suppliers strip",
      `${SITE}/partners`,
      0.5,
    ),
  ];
}

function demoResearchGaps(): string[] {
  return [
    "No public source states quote turnaround, quote volume, or win rate. All three are Missing until the client states them.",
    "No public source names who prices a job, who approves a price, or what happens when that person is unavailable.",
    "Cost Structure has no public support at all; nothing on the site or in the directory describes where the money goes.",
    "The 48-hour quote promise on the contact page is a marketing claim with no evidence behind it. Treat it as a claim to test, not a fact.",
    "The site is undated and several pages reference a 2022 equipment purchase, so any figure taken from it may be stale.",
    "Nothing public describes the handoff between shop drawings and fabrication, which is where a second constraint would most plausibly sit.",
  ];
}

function demoHypotheses(): ConstraintHypothesis[] {
  return [
    {
      canvasBlock: "Key Activities",
      type: "latency",
      evidenceHint:
        "The site promises quotes in 48 hours but names one person for estimating enquiries; a single-estimator shop of this size rarely holds a 48-hour promise at volume.",
      confirmationCondition:
        "The client states an average enquiry-to-quote elapsed time materially longer than the published promise, and can say where the time is spent.",
      killCondition:
        "The client shows a log where quotes actually go out inside two days, or says quote speed has never cost them a job.",
    },
    {
      canvasBlock: "Key Resources",
      type: "knowledge",
      evidenceHint:
        "One named estimating contact, an owner-led about page, and custom one-off work suggest pricing judgment concentrated in a single person.",
      confirmationCondition:
        "The client says in their own words that only one person can price a job and that the method is not written down.",
      killCondition:
        "Two or more people already price independently, or a documented price basis exists that someone else can apply.",
    },
    {
      canvasBlock: "Key Activities",
      type: "capacity",
      evidenceHint:
        "A CNC router, an edgebander and 22 staff at one site imply fabrication capacity that may be the real limit rather than the front office.",
      confirmationCondition:
        "The client says work is won but cannot be built in time, or that the shop floor is the thing turning work away.",
      killCondition:
        "The client says the shop has room and that the shortage is in work reaching the shop, not the shop's ability to build it.",
    },
  ];
}

function demoValueFlow(): ValueFlowStep[] {
  return [
    {
      id: "flow_demo_1",
      order: 1,
      name: "Enquiry received",
      description:
        "A general contractor's estimator sends a drawing set and a bid date, and someone in the office captures it.",
      input: "Contractor invitation to bid",
      output: "Logged enquiry with a bid date",
      actor: "Rosa Alvarez",
      system: "Shared estimating inbox and the office whiteboard",
      evidenceStatus: "public-research",
      sourceUrls: [`${SITE}/contact`],
      confidence: 0.6,
      confirmationQuestion: "When an invitation to bid arrives, who sees it first and where does it get written down?",
    },
    {
      id: "flow_demo_2",
      order: 2,
      name: "Quote pricing",
      description:
        "The drawing set is taken off and priced, and a number is put on the company's quote form and returned to the contractor.",
      input: "Logged enquiry with a bid date",
      output: "Priced quote sent to the contractor",
      actor: "Dana Whitfield",
      system: "Excel takeoff workbook, one per job",
      evidenceStatus: "gap",
      sourceUrls: [],
      confidence: 0.3,
      confirmationQuestion: "Walk me through what happens between the drawings arriving and a price going back out, and who touches it.",
    },
    {
      id: "flow_demo_3",
      order: 3,
      name: "Award received",
      description: "The contractor awards the package and the quote becomes a committed job.",
      input: "Priced quote sent to the contractor",
      output: "Awarded job with a purchase order",
      actor: "Rosa Alvarez",
      system: "Email and QuickBooks",
      evidenceStatus: "gap",
      sourceUrls: [],
      confidence: 0.3,
      confirmationQuestion: "At what exact moment does a quote become work you are obliged to build?",
    },
    {
      id: "flow_demo_4",
      order: 4,
      name: "Shop drawings",
      description:
        "The awarded package is drawn, submitted to the architect, marked up, revised and approved before anything is cut.",
      input: "Awarded job with a purchase order",
      output: "Architect-approved shop drawings",
      actor: "Priya Shah",
      system: "CAD and PDF markup submittals",
      evidenceStatus: "public-research",
      sourceUrls: [`${SITE}/services`],
      confidence: 0.65,
      confirmationQuestion: "Who draws the package after you win it, and how many approval rounds is normal?",
    },
    {
      id: "flow_demo_5",
      order: 5,
      name: "Fabrication",
      description:
        "Approved drawings are scheduled into the shop, materials are ordered against them, and the package is built and finished.",
      input: "Architect-approved shop drawings",
      output: "Finished millwork ready to load out",
      actor: "Terry Nakamura",
      system: "Whiteboard schedule and shop traveler packets",
      evidenceStatus: "public-research",
      sourceUrls: [`${SITE}/shop`],
      confidence: 0.6,
      confirmationQuestion: "How does an approved job get sequenced into the shop, and what decides which job goes first?",
    },
    {
      id: "flow_demo_6",
      order: 6,
      name: "Delivery and install",
      description: "The crew loads out, sets the millwork on site, and works the punch list until the job is accepted.",
      input: "Finished millwork ready to load out",
      output: "Installed and accepted millwork package",
      actor: "Miles Okonkwo",
      system: "Install punch list",
      evidenceStatus: "advisor-note",
      sourceUrls: [],
      confidence: 0.35,
      confirmationQuestion: "Who installs, and what still has to happen after install before you call the job finished?",
    },
  ];
}

function demoDiscoveryQuestions(): DiscoveryQuestion[] {
  return [
    {
      id: "q_demo_demand_1",
      section: "demand",
      question: "Who sends you work, and how does an invitation to bid actually reach you?",
      whyItMatters:
        "The Canvas has Customer Segments and Channels from the website only. If demand really arrives as estimator emails rather than through the form, the front of the flow is different from what we drew.",
      publicAssumption: "The markets page names general contractors, healthcare and financial interiors as the buyers.",
      sourceUrls: [`${SITE}/markets`, `${SITE}/contact`],
      evidenceStatus: "public-research",
      canvasBlock: "Customer Segments",
      flowStepId: "flow_demo_1",
      expectedAnswerType: "narrative",
      required: true,
      followUps: [
        "Of those, which one sends you the most work in a normal quarter?",
        "Is there demand you turn away, and what makes you turn it away?",
        "How much of it comes because an architect named you in the spec?",
      ],
    },
    {
      id: "q_demo_demand_2",
      section: "demand",
      question: "How many quote requests come in during a typical month?",
      whyItMatters:
        "Volume decides whether a queue in front of one person is a nuisance or the business's ceiling. No public source states it.",
      publicAssumption: "None. No public source states enquiry volume.",
      sourceUrls: [],
      evidenceStatus: "gap",
      canvasBlock: "Customer Segments",
      expectedAnswerType: "number",
      required: true,
      followUps: [
        "Is that number counted somewhere, or is it your sense of it?",
        "Has it moved over the last year, and in which direction?",
      ],
    },
    {
      id: "q_demo_promise_1",
      section: "promise",
      question: "Your contact page says quotes come back within 48 hours. Is that what actually happens?",
      whyItMatters:
        "A published promise the business cannot keep is either a marketing claim or a real service level. Which one it is changes the diagnosis entirely.",
      publicAssumption: "The contact page states that quotes are returned within 48 hours.",
      sourceUrls: [`${SITE}/contact`],
      evidenceStatus: "public-research",
      canvasBlock: "Value Propositions",
      expectedAnswerType: "narrative",
      required: true,
      followUps: [
        "When you miss it, what do you hear from the contractor?",
        "Would you rather be fast or be right on the number, if you had to pick?",
      ],
    },
    {
      id: "q_demo_flow_1",
      section: "flow",
      question: "Walk me from the invitation to bid arriving to the quote going back out. Who touches it and in what order?",
      whyItMatters:
        "Steps 2 and 3 of the flow we drew have no public support at all. This is the section of the flow the whole diagnosis rests on.",
      publicAssumption: "None. This part of the flow is a proposal with no public source behind it.",
      sourceUrls: [],
      evidenceStatus: "gap",
      canvasBlock: "Key Activities",
      flowStepId: "flow_demo_2",
      expectedAnswerType: "narrative",
      required: true,
      followUps: [
        "Where does it physically sit while it is waiting?",
        "What is the longest one has ever waited, and what happened to it?",
        "Which step in that chain do you personally hear complaints about?",
      ],
    },
    {
      id: "q_demo_flow_2",
      section: "flow",
      question: "After you win a job, who draws it and how many approval rounds is normal?",
      whyItMatters:
        "Shop drawings sit between award and fabrication. If quoting gets faster, this is the step most likely to absorb the extra work.",
      publicAssumption: "The services page states that shop drawings are produced in-house and submitted for architect approval.",
      sourceUrls: [`${SITE}/services`],
      evidenceStatus: "public-research",
      canvasBlock: "Key Activities",
      flowStepId: "flow_demo_4",
      expectedAnswerType: "person",
      required: true,
      followUps: [
        "Does that person do anything else, or is drawing their whole job?",
        "How long does the architect typically hold a submittal?",
      ],
    },
    {
      id: "q_demo_constraint_1",
      section: "constraint",
      question: "Of the steps we just walked, which one is the one that costs you work?",
      whyItMatters:
        "We have three competing hypotheses — latency at quoting, a knowledge dependency in pricing, and shop capacity. The client's own answer is the cheapest way to separate them.",
      publicAssumption: "The site promises a fast quote while naming one estimating contact; those two facts are in tension.",
      sourceUrls: [`${SITE}/contact`],
      evidenceStatus: "public-research",
      canvasBlock: "Key Activities",
      hypothesisId: "Key Activities|latency",
      expectedAnswerType: "narrative",
      required: true,
      followUps: [
        "What have you already tried against it?",
        "What would show the opposite — that quotes actually go out inside two days and speed has never cost you a job?",
        "If that step disappeared tomorrow, what is the next thing that would hurt?",
      ],
    },
    {
      id: "q_demo_baseline_1",
      section: "baseline",
      question: "From the day an enquiry is logged to the day the quote goes out, how many days is it on average?",
      whyItMatters:
        "This is the one number the whole engagement will be measured on. Without it, no before-and-after claim may be made at all.",
      publicAssumption: "None. No public source states this number.",
      sourceUrls: [],
      evidenceStatus: "gap",
      canvasBlock: "Key Activities",
      flowStepId: "flow_demo_2",
      expectedAnswerType: "number",
      required: true,
      followUps: [
        "Is that measured from a log, or is it your impression?",
        "Who keeps that log, and would they keep it exactly the same way for the next month?",
        "What is the spread — what does the fastest one look like, and the slowest?",
      ],
    },
    {
      id: "q_demo_roles_1",
      section: "roles",
      question: "Who can price a job, and who approves the price before it goes out?",
      whyItMatters:
        "A single point of dependency is only a finding if the client says it plainly. The about page names one contact, which is suggestive and nothing more.",
      publicAssumption: "The about page names the owner as the only estimating contact.",
      sourceUrls: [`${SITE}/about`],
      evidenceStatus: "public-research",
      canvasBlock: "Key Resources",
      hypothesisId: "Key Resources|knowledge",
      expectedAnswerType: "person",
      required: true,
      followUps: [
        "What happens to quoting when that person is on holiday?",
        "Has anyone else ever priced one, and what happened to that number?",
        "Which part of the price is judgment, and which part is the same every time?",
      ],
    },
    {
      id: "q_demo_feasibility_1",
      section: "feasibility",
      question: "If we changed one thing about quoting for four weeks, who would have to do the work and what would that cost them?",
      whyItMatters:
        "A prescription nobody has time to run is not a prescription. Feasibility is a client fact, not an advisor assumption.",
      publicAssumption: "None. Nothing public speaks to available time or appetite for change.",
      sourceUrls: [],
      evidenceStatus: "gap",
      canvasBlock: "Key Resources",
      expectedAnswerType: "narrative",
      required: false,
      followUps: [
        "How many evenings could you personally give this before it becomes resented?",
        "Who would have to be told before anything changes?",
      ],
    },
    {
      id: "q_demo_feasibility_2",
      section: "feasibility",
      question: "What would have to be true in four weeks for you to say this worked, and what would tell you it did not?",
      whyItMatters:
        "The kill condition has to be the client's own, agreed before the sprint, or it will be argued away afterwards.",
      publicAssumption: "None.",
      sourceUrls: [],
      evidenceStatus: "gap",
      expectedAnswerType: "narrative",
      required: false,
      followUps: [
        "If the number moves and nothing else changes, is that enough for you?",
        "Who else needs to believe it before it counts?",
      ],
    },
  ];
}

export function demoResearch(): ResearchSynthesis {
  return {
    sourceUrl: SITE,
    fetchedAt: RESEARCH_AT,
    fetchStatus: "fetched",
    title: `${DEMO_CLIENT_NAME} — public research (practice data)`,
    description:
      "An architectural millwork shop building custom casework and store fixtures for commercial interior contractors. Everything on this page is invented for practice.",
    facts: demoResearchFacts(),
    gaps: demoResearchGaps(),
    constraintHypotheses: demoHypotheses(),
    valueFlow: demoValueFlow(),
    discoveryQuestions: demoDiscoveryQuestions(),
    researchMode: "deterministic",
    providerStatus: "not-configured",
    sourceCount: 8,
  };
}

function demoSourceRegister(): SourceEntry[] {
  return [
    { id: "src_demo_site", label: "Meridian Millwork — public website", url: SITE, provenance: "public-research", capturedAt: RESEARCH_AT },
    { id: "src_demo_contact", label: "Meridian Millwork — contact page", url: `${SITE}/contact`, provenance: "public-research", capturedAt: RESEARCH_AT },
    { id: "src_demo_services", label: "Meridian Millwork — services page", url: `${SITE}/services`, provenance: "public-research", capturedAt: RESEARCH_AT },
    { id: "src_demo_directory", label: "Commercial Interiors Trade Register — listing", url: DIRECTORY_URL, provenance: "public-research", capturedAt: RESEARCH_AT },
    { id: "src_demo_call1", label: "Discovery call recording and transcript (practice)", provenance: "client-stated", capturedAt: CALL_1_AT },
    { id: "src_demo_call2", label: "Findings call recording and transcript (practice)", provenance: "client-stated", capturedAt: CALL_2_AT },
    { id: "src_demo_log", label: "Enquiry log extract supplied by Rosa Alvarez (practice)", provenance: "doc", capturedAt: "2026-05-13T09:15:00.000Z" },
  ];
}

/* ------------------------------------------------------------------ *
 * Canvas
 * ------------------------------------------------------------------ */

function update(
  canvasBlock: CanvasUpdate["canvasBlock"],
  statement: string,
  quote: string,
  speaker: string,
  timestamp: string,
  replacesResearchStatement?: string,
): CanvasUpdate {
  const entry: CanvasUpdate = { canvasBlock, statement, quote, speaker, timestamp, provenance: "client-stated" };
  if (replacesResearchStatement) entry.replacesResearchStatement = replacesResearchStatement;
  return entry;
}

function call1CanvasUpdates(): CanvasUpdate[] {
  return [
    update(
      "Customer Segments",
      "Buyers are commercial interior general contractors building out clinics, bank branches and coffee shops; an architect sometimes specs Meridian by name but the contractor still sends the package.",
      "General contractors, mostly. Commercial interiors. They are building out a clinic or a bank branch or a coffee shop, and the millwork package comes to us to price. Once in a while an architect specs us by name, which is nice, but the GC still has to send it over.",
      "Dana Whitfield",
      "00:52",
    ),
    update(
      "Channels",
      "Work arrives almost entirely as estimator emails carrying a drawing set and a bid date; the website form has produced about three enquiries all year.",
      "Email. Nearly always email. There is a form on the website, but I think we have had three of those all year. It is an estimator sending a drawing set and a bid date.",
      "Rosa Alvarez",
      "01:26",
      "The contact page offers a request-a-quote form and a single estimating email address as the ways to submit work.",
    ),
    update(
      "Key Activities",
      "Every enquiry is logged on a whiteboard, the drawings go into a job folder, and it then waits for the owner to price it.",
      "I log it on the whiteboard — GC, job name, bid date — and I drop the drawings into the job folder on the server. Then it waits for Dana.",
      "Rosa Alvarez",
      "02:30",
    ),
    update(
      "Key Resources",
      "Only the owner can price a job; the pricing method is not written down anywhere and no one else in the business can apply it.",
      "Nobody else here can price a job. It is not that they are not smart. The pricing is in my head. I have been doing takeoffs on this stuff for nineteen years. I know what a curved reception desk in solid surface is going to fight us on. Priya could do the takeoff, the quantities, all of that. The number at the bottom is mine.",
      "Dana Whitfield",
      "03:25",
    ),
    update(
      "Value Propositions",
      "Quote turnaround is about nine days from logged enquiry to sent quote, not the 48 hours the website promises.",
      "I pulled the log in January because the Brightwater estimator was complaining. It is more like 9 days per quote. That is the average from the day I log it to the day it goes out.",
      "Rosa Alvarez",
      "04:43",
      "The contact page states that quotes are returned within 48 hours.",
    ),
    update(
      "Key Partners",
      "Sheet goods come from one distributor and hardware from another, and the difficult finishes are subcontracted to a local finishing shop because conversion varnish is no longer sprayed in-house.",
      "Sheet goods come from Kepler Supply out of Toledo. Hardware is Grainhouse. The difficult finishes we sub out to Alder Coatings across town, because we do not spray conversion varnish here anymore.",
      "Rosa Alvarez",
      "10:56",
      "The suppliers strip names a sheet-goods distributor and a hardware distributor; no finishing partner is named.",
    ),
    update(
      "Revenue Streams",
      "All revenue is fixed-price contract work billed by progress; there is no service, maintenance or recurring revenue.",
      "All of it. Fixed-price contract work, billed by progress. There is no service side, no maintenance, nothing recurring. We install it and we are done until the next build-out.",
      "Dana Whitfield",
      "11:28",
    ),
    update(
      "Cost Structure",
      "Shop payroll and the building lease dominate cost; material is close to a pass-through with a markup.",
      "Payroll. Payroll is the whole thing, shop labor and the lease on this building. Material is more or less a pass-through, I mark it up, but payroll is what decides whether the year works.",
      "Dana Whitfield",
      "11:55",
    ),
    update(
      "Customer Relationships",
      "The owner is the relationship: every contractor the shop works for has her mobile number and uses it during the working day.",
      "Me. Every GC we work for has my mobile number.",
      "Dana Whitfield",
      "12:24",
    ),
  ];
}

function call2CanvasUpdates(): CanvasUpdate[] {
  return [
    update(
      "Key Activities",
      "Pricing a quote takes about an hour of work; the delay is the queue in front of that hour, not the hour itself.",
      "That is it. That is exactly it. The hour of work is not the problem. It is the eight days it sits before I get to the hour.",
      "Dana Whitfield",
      "01:38",
    ),
    update(
      "Key Resources",
      "Shop drawings are split between the drafter, who does casework, and the shop foreman, who does fixture and store-rollout work — roughly sixty-forty, and more like seventy-thirty in the autumn.",
      "She does not. That is my fault, I said it badly last time. Priya does the casework drawings. Terry does the fixture drawings, the display work, anything going into a store rollout. It is maybe sixty-forty.",
      "Dana Whitfield",
      "02:40",
    ),
  ];
}

/** The canonical Canvas: research first, then the client's own words on top of it. */
export function demoCanvas(): Canvas {
  return applyCanvasUpdates(buildCanvasFromResearch(demoResearch()), [
    ...call1CanvasUpdates(),
    ...call2CanvasUpdates(),
  ]);
}

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

export function demoRoles(): RoleMapEntry[] {
  return [
    {
      person: "Dana Whitfield",
      reportsTo: "",
      responsibilities: ["Quote pricing", "Customer relationships", "Final price approval"],
      tasks: [
        "Takeoff and price every quote that leaves the building",
        "Write and own the assembly price book",
        "Site walks and contractor calls on live jobs",
      ],
      doesTask: true,
      accountableForOutcome: true,
      judgmentOrGrind: "mixed",
      approvalAuthority: "Sole approval of every price — in her own words at 15:00 on the discovery call, there is nobody above her",
      singlePointDependency: true,
    },
    {
      person: "Rosa Alvarez",
      reportsTo: "Dana Whitfield",
      responsibilities: ["Enquiry received", "Award received", "Material ordering"],
      tasks: [
        "Log every enquiry on the whiteboard and in the enquiry sheet",
        "Put the owner's number on the quote form and send it",
        "Order materials against approved drawings",
      ],
      doesTask: true,
      accountableForOutcome: false,
      judgmentOrGrind: "grind",
      approvalAuthority: "",
      singlePointDependency: false,
    },
    {
      person: "Priya Shah",
      reportsTo: "Dana Whitfield",
      responsibilities: ["Shop drawings (casework)"],
      tasks: ["Draw awarded casework packages", "Handle architect markups and revisions"],
      doesTask: true,
      accountableForOutcome: false,
      judgmentOrGrind: "mixed",
      approvalAuthority: "",
      singlePointDependency: false,
    },
    {
      person: "Terry Nakamura",
      reportsTo: "Dana Whitfield",
      responsibilities: ["Fabrication", "Shop drawings (fixtures)", "CNC nesting"],
      tasks: [
        "Schedule approved jobs into the shop",
        "Draw fixture and store-rollout packages after hours",
        "Nest and run the CNC",
      ],
      doesTask: true,
      accountableForOutcome: false,
      judgmentOrGrind: "mixed",
      approvalAuthority: "",
      singlePointDependency: true,
    },
    {
      person: "Miles Okonkwo",
      reportsTo: "Terry Nakamura",
      responsibilities: ["Delivery and install"],
      tasks: ["Load out and set installed millwork", "Work the punch list to acceptance"],
      doesTask: true,
      accountableForOutcome: false,
      judgmentOrGrind: "grind",
      approvalAuthority: "",
      singlePointDependency: false,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Baseline, finding, sprint, outcome, catalog
 * ------------------------------------------------------------------ */

const BASELINE_SOURCE =
  "Rosa Alvarez at 04:43 on the discovery call, from her own enquiry log, and confirmed by Dana Whitfield at 01:02 on the findings call.";

/**
 * The two readings this diagnosis competed against, each with the findings-call line that
 * argues against it. Price is the owner's own named alternative and is deliberately recorded
 * as unresolved rather than beaten: it is the engagement's stop condition, not a dead rival.
 * Every quote below is a contiguous span of a line that already exists in `CALL_2`.
 */
export function demoRejectedHypotheses(): RejectedHypothesis[] {
  return [
    {
      constraintType: "capacity",
      canvasBlock: "Key Resources",
      reason:
        "Ruled out by the owner on the record. Hiring a second estimator in 2023 did not move the number, and the pricing work itself takes an hour — it is the eight days of queue in front of that hour that is long, which is a dependency, not a shortage of hands.",
      quote: "No, and I would have told you it was capacity. It is not. The thing that makes the number is in my head and nowhere else.",
      speaker: "Dana Whitfield",
      timestamp: "02:06",
      line: lineNumberIn(2, "I would have told you it was capacity"),
    },
    {
      constraintType: "policy",
      canvasBlock: "Revenue Streams",
      reason:
        "Not disproved — deliberately left open. Price is the owner's own alternative explanation and no lost bid has been traced to a reason, so it is ranked second rather than dismissed. It becomes the reading the moment quotes go out in three days and the win rate has not moved.",
      quote: "If quotes go out in three days and we still do not win any more of them. Then it was never speed, it was my price, and that is a different conversation.",
      speaker: "Dana Whitfield",
      timestamp: "06:40",
      line: lineNumberIn(2, "it was never speed, it was my price"),
    },
  ];
}

/** 1-based index of the practice transcript line containing `fragment`. */
function lineNumberIn(callNumber: 1 | 2, fragment: string): number {
  const at = demoLines(callNumber).findIndex((line) => line.text.includes(fragment));
  if (at === -1) {
    throw new Error(`Practice transcript ${callNumber} no longer contains: ${fragment}`);
  }
  return at + 1;
}

export function demoBaseline(): BaselineMetric {
  return {
    name: "Quote turnaround time",
    value: "9",
    unit: "days",
    period: "per quote",
    source: BASELINE_SOURCE,
  };
}

function demoEndingMetric(): BaselineMetric {
  return {
    name: "Quote turnaround time",
    value: "3",
    unit: "days",
    period: "per quote",
    source:
      "Rosa Alvarez's enquiry log, unchanged, for the four weeks from 2026-05-28; read back and confirmed by Dana Whitfield on the measurement call.",
  };
}

export function demoFinding(): ConstraintFinding {
  return {
    constraintId: "con_demo_quote_pricing",
    client: DEMO_CLIENT_NAME,
    canvasBlock: "Key Activities",
    constraintType: "knowledge",
    findingStatus: "approved",
    symptoms: [
      {
        statement: "Every enquiry queues behind one person before it can be priced.",
        number: "9 days per quote",
      },
      {
        statement: "Enquiries arrive faster than the one person who can price them can clear them.",
        number: "about 30 requests a month",
      },
      {
        statement: "Contractors award to whoever answers first, and the shop is rarely first.",
        number: "about 20 percent",
      },
      {
        statement: "Pricing stops entirely when the owner is away, and bid dates pass while work sits.",
        number: "eleven",
      },
    ],
    evidence: [
      {
        quote: "I do. I price every quote that leaves this building. Every one.",
        speaker: "Dana Whitfield",
        timestamp: "03:11",
        transcriptUrl: "",
        provenance: "client-stated",
      },
      {
        quote:
          "Nobody else here can price a job. It is not that they are not smart. The pricing is in my head. I have been doing takeoffs on this stuff for nineteen years. I know what a curved reception desk in solid surface is going to fight us on. Priya could do the takeoff, the quantities, all of that. The number at the bottom is mine.",
        speaker: "Dana Whitfield",
        timestamp: "03:25",
        transcriptUrl: "",
        provenance: "client-stated",
      },
      {
        quote:
          "I pulled the log in January because the Brightwater estimator was complaining. It is more like 9 days per quote. That is the average from the day I log it to the day it goes out.",
        speaker: "Rosa Alvarez",
        timestamp: "04:43",
        transcriptUrl: "",
        provenance: "client-stated",
      },
      {
        quote:
          "We lose on speed. I know we do. A lot of these GCs will take the first reasonable number from a shop they trust. We are the shop they trust. We are just not first.",
        speaker: "Dana Whitfield",
        timestamp: "06:24",
        transcriptUrl: "",
        provenance: "client-stated",
      },
      {
        quote:
          "That is it. That is exactly it. The hour of work is not the problem. It is the eight days it sits before I get to the hour.",
        speaker: "Dana Whitfield",
        timestamp: "01:38",
        transcriptUrl: "",
        provenance: "client-stated",
      },
    ],
    baselineMetric: demoBaseline(),
    prescription: {
      description:
        "Dana writes a one-page price book covering the six or seven assemblies she named — base runs, uppers, a reception desk, a transaction counter, slat wall, a nurses station — and pre-approves it. Rosa returns any enquiry the book covers the same day, at Dana's own prices, without waiting for her. Anything over the $25,000 Dana named, anything in solid surface, and anything the book does not cover still comes back to Dana for quote pricing. The log Rosa already keeps stays exactly as it is so the before and after compare.",
      whySmallestIntervention:
        "It moves no work off Dana that she said was judgment, hires nobody, buys no software, and changes no system. It takes the part of pricing she herself called the same thing over and over and writes it down once, so the queue in front of her hour of work drains without her. If she hates it, she stops using the book and nothing else has been disturbed.",
    },
    projectedDelta: {
      formula: "measured ending metric - confirmed starting metric",
      namedInputs: [
        "confirmed starting metric of 9 days per quote",
        "measured ending metric after the four weeks Dana agreed to",
        "Rosa Alvarez's enquiry log, kept unchanged through the sprint",
      ],
      low: "",
      base: "",
      high: "",
      confidence:
        "No range is projected. The only number this engagement will claim is the measured ending metric against the confirmed baseline.",
    },
    baselineInstrumentation: {
      required: false,
      firstSprintTask: "",
      measurementClockStartsWhen:
        "The baseline is already confirmed from Rosa Alvarez's log. The clock starts the day the price book is first used on a live enquiry.",
    },
    humanOwner: { name: "Dana Whitfield", role: "Owner" },
    predictedNextConstraint:
      "Shop drawings. Priya Shah draws casework and Terry Nakamura draws fixtures after his day on the floor, and architect approval time is outside the shop's control, so won work will queue there next.",
    killCondition:
      "In Dana's own words at 06:40 on the findings call — if quotes go out in three days and the win rate does not move, speed was never the constraint. Stop the sprint and re-diagnose at price rather than latency.",
    // Deliberately deferred. These print as "not the constraint — revisit after it moves"
    // and as the written out-of-scope list in the proposal, so they have to be real things
    // we are choosing not to touch, not a list of sources.
    appendixItems: [
      // The rivals, first, in the same shape the live pipeline now writes them.
      ...demoRejectedHypotheses().map(rejectedHypothesisAppendixItem),
      "Shop-drawing capacity and architect approval time — named by the client as the likely next constraint, and deliberately left alone this sprint.",
      "CNC nesting resting on one self-taught person. A real single-point risk, but nothing in the evidence says it is limiting throughput today.",
      "The win rate of about 20 percent. It is why the constraint matters, not the thing being changed; it is watched, not worked on.",
      "The whiteboard as the real schedule. Left exactly as it is so the before-and-after measurement stays comparable.",
      "Whether the $25,000 threshold is the right line. Revisit once the price book has been used on live enquiries.",
    ],
  };
}

export function demoSprint(): SprintRecord {
  const finding = demoFinding();
  return {
    sprintId: "spr_demo_1",
    constraintId: finding.constraintId,
    constraintType: finding.constraintType,
    activatedAt: SPRINT_AT,
    activatedBy: DEMO_ADVISOR,
    prescription: finding.prescription.description,
    humanOwner: finding.humanOwner,
    startingMetric: demoBaseline(),
    measurementClockStartedAt: SPRINT_AT,
    tasks: [
      {
        id: "tsk_demo_1",
        task: "Write the one-page price book for the six or seven assemblies Dana named, in one evening, with the advisor.",
        owner: "Dana Whitfield",
        status: "done",
      },
      {
        id: "tsk_demo_2",
        task: "Sit with Rosa while she quotes the first three enquiries straight off the book, and correct the book where it is wrong.",
        owner: "Dana Whitfield",
        status: "done",
      },
      {
        id: "tsk_demo_3",
        task: "Tell Rosa, in Dana's own words, that a bad number off the book is Dana's and not hers.",
        owner: "Dana Whitfield",
        status: "done",
      },
      {
        id: "tsk_demo_4",
        task: "Keep the enquiry log exactly as it is — date in, date out, same sheet — so the before and after compare.",
        owner: "Rosa Alvarez",
        status: "done",
      },
      {
        id: "tsk_demo_5",
        task: `Record where the bottleneck moves after the intervention. Kill condition: ${finding.killCondition}`,
        owner: "Dana Whitfield",
        status: "done",
      },
    ],
  };
}

export function demoOutcome(): OutcomeMeasurement {
  const starting = demoBaseline();
  const ending = demoEndingMetric();
  // The same inference the server would make, run here so the demo shows real reasoning
  // rather than a hard-coded verdict: "days" measures elapsed time, so lower is better.
  const directionInference = inferMetricDirection(ending, { constraintType: "knowledge" });
  const improvedWhen = directionInference.improvedWhen ?? undefined;
  const { delta, blockedReason } = computeMetricDelta(starting, ending, {
    baselineConfirmed: true,
    improvedWhen,
  });
  const outcome: OutcomeMeasurement = {
    measuredAt: MEASURED_AT,
    measuredBy: DEMO_ADVISOR,
    startingMetric: starting,
    endingMetric: ending,
    delta,
    improvedWhen,
    directionInference,
    constraintMoved: true,
    nextConstraintObserved:
      "Shop drawings — two packages sat waiting on architect approval while the shop had capacity, and Terry is drawing fixtures after five again",
    evidence: [
      {
        quote: "Three days. Rosa sent eleven off the book without me and I looked at four of them.",
        source: "Dana Whitfield, Owner — measurement call, 2026-06-25 (practice data)",
      },
      {
        quote: "Same sheet, same two columns. I did not change anything about how I log it.",
        source: "Rosa Alvarez, Office Manager — measurement call, 2026-06-25 (practice data)",
      },
      {
        quote: "We are waiting on the architect now, not on me. That is a different problem and I will take it.",
        source: "Dana Whitfield, Owner — measurement call, 2026-06-25 (practice data)",
      },
    ],
  };
  if (blockedReason) outcome.deltaBlockedReason = blockedReason;
  return outcome;
}

export function demoCatalogEntry(): CatalogEntry {
  const outcome = demoOutcome();
  const finding = demoFinding();
  return {
    entryId: "cat_demo_1",
    constraintType: finding.constraintType,
    canvasBlock: finding.canvasBlock,
    pattern:
      "Owner-held pricing knowledge as a queue: every quote waits on the one person who can price it, so turnaround is set by that person's calendar rather than by the work.",
    prescription:
      "Pre-price the recurring assemblies into an owner-written price book, let the office return book-covered enquiries same day, and keep an explicit value threshold and material exception routed back to the owner.",
    measuredResult: outcome.delta
      ? `${outcome.delta.absolute} (${outcome.delta.direction}${outcome.delta.interpretation === "not-interpreted" ? "" : `, ${outcome.delta.interpretation}`}) on ${outcome.endingMetric.name}`
      : `Not claimed — ${outcome.deltaBlockedReason ?? "no comparable measurement"}`,
    industryContext:
      "Architectural millwork and store fixtures, 22 staff, single shop, quoting to commercial interior general contractors on short bid dates. Practice data.",
    reusableFor:
      "Owner-priced job shops where the same handful of assemblies recur across quotes, the owner can state a value threshold above which they still want to price, and someone already logs enquiry dates well enough to measure. Not reusable where every job is genuinely bespoke or where no one records when an enquiry arrived.",
    writtenAt: CATALOG_AT,
  };
}

/* ------------------------------------------------------------------ *
 * Transcript synthesis
 * ------------------------------------------------------------------ */

function quote(
  speaker: string,
  timestamp: string,
  text: string,
  reason: string,
): TranscriptSynthesis["quotes"][number] {
  return { speaker, timestamp, text, speakerConfidence: "advisor-verified", reason, provenance: "client-stated" };
}

function call1Synthesis(): TranscriptSynthesis {
  const lines = demoLines(1);
  const metrics = extractMetrics(lines);
  const finding = demoFinding();
  return {
    callNumber: 1,
    lineCount: lines.length,
    quotes: [
      quote("Dana Whitfield", "03:11", "I do. I price every quote that leaves this building. Every one.", "States plainly that one person prices every quote."),
      quote(
        "Dana Whitfield",
        "03:25",
        "Nobody else here can price a job. It is not that they are not smart. The pricing is in my head. I have been doing takeoffs on this stuff for nineteen years. I know what a curved reception desk in solid surface is going to fight us on. Priya could do the takeoff, the quantities, all of that. The number at the bottom is mine.",
        "Single point of dependency in the client's own words, with the knowledge named as undocumented.",
      ),
      quote(
        "Rosa Alvarez",
        "04:43",
        "I pulled the log in January because the Brightwater estimator was complaining. It is more like 9 days per quote. That is the average from the day I log it to the day it goes out.",
        "Only counted number for quote turnaround, with a stated source and definition.",
      ),
      quote(
        "Dana Whitfield",
        "06:24",
        "We lose on speed. I know we do. A lot of these GCs will take the first reasonable number from a shop they trust. We are the shop they trust. We are just not first.",
        "Connects the latency to lost work rather than to price.",
      ),
      quote(
        "Rosa Alvarez",
        "06:53",
        "I track it in the spreadsheet. We are winning about 20 percent of what we quote.",
        "Client-tracked win rate; the only figure available for the cost of the delay.",
      ),
      quote(
        "Dana Whitfield",
        "16:43",
        "Um. We would win more, and then — yeah. Drawings. Priya already has a queue. If we win more work we are going to jam up at shop drawings, I would bet money on it.",
        "Client's own prediction of where the constraint moves next.",
      ),
    ],
    metrics,
    baselineStatus: baselineStatusFor(metrics),
    gaps: [
      "The owner's own estimate of turnaround (four to five days) and the office manager's log (9 days per quote) disagree. The log is the stronger source but has not yet been seen.",
      "No one has said how many of the roughly 30 monthly requests are the same recurring assemblies, which is what would make a price book viable.",
      "Shop drawing capacity was named by the client as the likely next constraint but no number was given for it.",
      "The win rate of about 20 percent is tracked in a spreadsheet nobody has produced yet.",
    ],
    constraintCandidate: {
      ...finding,
      constraintId: "con_demo_quote_pricing",
      findingStatus: "provisional",
      evidence: finding.evidence.filter((item) => item.timestamp !== "01:38"),
      predictedNextConstraint:
        "Shop drawings, on the client's own prediction at 16:43. Not yet corroborated by anyone who does that work.",
    },
    contradictions: [
      {
        researchStatement: "The contact page states that quotes are returned within 48 hours.",
        researchSourceUrl: `${SITE}/contact`,
        clientQuote:
          "I pulled the log in January because the Brightwater estimator was complaining. It is more like 9 days per quote. That is the average from the day I log it to the day it goes out.",
        speaker: "Rosa Alvarez",
        timestamp: "04:43",
        canvasBlock: "Value Propositions",
        resolution: "client-corrected",
      },
      {
        researchStatement: "The contact page offers a request-a-quote form and a single estimating email address as the ways to submit work.",
        researchSourceUrl: `${SITE}/contact`,
        clientQuote:
          "Email. Nearly always email. There is a form on the website, but I think we have had three of those all year. It is an estimator sending a drawing set and a bid date.",
        speaker: "Rosa Alvarez",
        timestamp: "01:26",
        canvasBlock: "Channels",
        resolution: "client-corrected",
      },
      {
        researchStatement: "A trade directory listing records the company at 22 employees at one location in Ohio.",
        researchSourceUrl: DIRECTORY_URL,
        clientQuote:
          "We got bigger. Twenty-two people now, we were fourteen. More work in the shop means less of me at a desk. And the router — we bought the CNC in 2022 and it changed what we could take on, so people started asking us for bigger packages. Which is good. A bigger package is a longer takeoff.",
        speaker: "Dana Whitfield",
        timestamp: "07:20",
        canvasBlock: "Key Resources",
        resolution: "client-confirmed",
      },
      {
        researchStatement:
          "Project pages describe fixed-price package work for named build-outs; no recurring service, maintenance or warranty offering is described anywhere on the site.",
        researchSourceUrl: `${SITE}/projects`,
        clientQuote:
          "All of it. Fixed-price contract work, billed by progress. There is no service side, no maintenance, nothing recurring. We install it and we are done until the next build-out.",
        speaker: "Dana Whitfield",
        timestamp: "11:28",
        canvasBlock: "Revenue Streams",
        resolution: "client-confirmed",
      },
    ],
    decisions: [
      {
        decision: "I will send you the log.",
        quote: "I will send you the log. Rosa, can you pull the last six months out of the sheet for him?",
        speaker: "Dana Whitfield",
        timestamp: "17:40",
        owner: "Dana Whitfield",
      },
    ],
    tasks: [
      {
        task: "I will send it over tomorrow morning.",
        quote: "I will send it over tomorrow morning.",
        speaker: "Rosa Alvarez",
        timestamp: "17:51",
        owner: "Rosa Alvarez",
        flowStepId: "flow_demo_1",
      },
      {
        task: "Think about which parts of a quote you would genuinely not need to see.",
        quote: "That is a harder question than it sounds.",
        speaker: "Dana Whitfield",
        timestamp: "18:11",
        owner: "Dana Whitfield",
        flowStepId: "flow_demo_2",
      },
    ],
    canvasUpdates: call1CanvasUpdates(),
    flowConfirmations: [
      {
        flowStepId: "flow_demo_1",
        status: "confirmed",
        quote:
          "I log it on the whiteboard — GC, job name, bid date — and I drop the drawings into the job folder on the server. Then it waits for Dana.",
        speaker: "Rosa Alvarez",
        timestamp: "02:30",
      },
      {
        flowStepId: "flow_demo_2",
        status: "confirmed",
        quote: "I do. I price every quote that leaves this building. Every one.",
        speaker: "Dana Whitfield",
        timestamp: "03:11",
      },
      {
        flowStepId: "flow_demo_3",
        status: "unconfirmed",
        quote: "",
        speaker: "",
        timestamp: "",
      },
      {
        flowStepId: "flow_demo_4",
        status: "confirmed",
        quote:
          "Then shop drawings. That is Priya. She draws the package, it goes to the architect, they mark it up, we revise, they approve. Two rounds usually. Three if the architect is precious about reveals.",
        speaker: "Dana Whitfield",
        timestamp: "09:19",
      },
      {
        flowStepId: "flow_demo_5",
        status: "confirmed",
        quote:
          "Then Terry schedules it into the shop. Materials get ordered off the approved drawings, that is Rosa, and it goes up on the whiteboard by install date.",
        speaker: "Dana Whitfield",
        timestamp: "10:05",
      },
      {
        flowStepId: "flow_demo_6",
        status: "confirmed",
        quote:
          "Miles and two guys. Three if it is a big fixture package. They load out, they set it, they punch it, and we are done.",
        speaker: "Dana Whitfield",
        timestamp: "10:33",
      },
    ],
    roles: demoRoles().map((role) =>
      role.person === "Terry Nakamura"
        ? { ...role, responsibilities: ["Fabrication", "CNC nesting"], singlePointDependency: false }
        : role,
    ),
    analysisMode: "deterministic",
    modelStatus: "not-configured",
    speakerSummary: speakerSummary(lines),
  };
}

function call2Synthesis(): TranscriptSynthesis {
  const lines = demoLines(2);
  const metrics = extractMetrics(lines);
  return {
    callNumber: 2,
    lineCount: lines.length,
    quotes: [
      quote(
        "Dana Whitfield",
        "01:02",
        "I went back through the sheet myself after we talked. It is 9 days per quote, yes. I wanted it to be wrong and it is not.",
        "Owner confirms the baseline against her own reading of the log.",
      ),
      quote(
        "Dana Whitfield",
        "01:38",
        "That is it. That is exactly it. The hour of work is not the problem. It is the eight days it sits before I get to the hour.",
        "Confirms the constraint is the queue, not the work.",
      ),
      quote(
        "Dana Whitfield",
        "02:06",
        "No, and I would have told you it was capacity. It is not. The thing that makes the number is in my head and nowhere else.",
        "Client rules out the capacity hypothesis in her own words.",
      ),
      quote(
        "Dana Whitfield",
        "04:31",
        "If I am honest, six or seven assemblies cover most of what we quote. Base runs, uppers, a reception desk, a transaction counter, slat wall, a nurses station. That is the bulk of it.",
        "Establishes that the prescription has something real to cover.",
      ),
      quote(
        "Dana Whitfield",
        "05:27",
        "Me. It is my book. If Rosa sends out a bad number off my book, that is mine, not hers, and she needs to hear me say that.",
        "Named human owner accepts accountability for the intervention.",
      ),
      quote(
        "Dana Whitfield",
        "06:40",
        "If quotes go out in three days and we still do not win any more of them. Then it was never speed, it was my price, and that is a different conversation.",
        "Kill condition, stated by the client before the sprint starts.",
      ),
      quote(
        "Terry Nakamura",
        "07:34",
        "Drawings. Same as Dana said. There is no version of more work where drawings do not back up first, because approvals are not in our control. The architect sits on it for a week and we cannot start cutting.",
        "Corroborates the predicted next constraint from the person who would feel it.",
      ),
    ],
    metrics,
    baselineStatus: baselineStatusFor(metrics),
    gaps: [
      "Nobody has counted how many enquiries the price book would have covered historically; the six or seven assemblies are Dana's recollection, not a count.",
      "Architect approval time was described as a week by Terry but is not measured anywhere, so the next constraint has no baseline yet.",
      "The $25,000 threshold is the owner's judgment on the day and has no history behind it. Expect it to move once the book is in use.",
    ],
    constraintCandidate: { ...demoFinding(), findingStatus: "client-verified" },
    contradictions: [
      {
        researchStatement:
          "The services page states that shop drawings are produced in-house and submitted to the architect for approval before fabrication.",
        researchSourceUrl: `${SITE}/services`,
        clientQuote:
          "She does not. That is my fault, I said it badly last time. Priya does the casework drawings. Terry does the fixture drawings, the display work, anything going into a store rollout. It is maybe sixty-forty.",
        speaker: "Dana Whitfield",
        timestamp: "02:40",
        canvasBlock: "Key Activities",
        resolution: "client-corrected",
      },
    ],
    decisions: [
      {
        decision: "Four weeks. I can give you four weeks before the Q3 work lands.",
        quote: "Four weeks. I can give you four weeks before the Q3 work lands.",
        speaker: "Dana Whitfield",
        timestamp: "06:21",
        owner: "Dana Whitfield",
      },
      {
        decision: "Nobody is touching the form. Date in, date out, same sheet.",
        quote: "Nobody is touching the form. Date in, date out, same sheet.",
        speaker: "Dana Whitfield",
        timestamp: "06:06",
        owner: "Dana Whitfield",
      },
      {
        decision: "Anything over about $25,000 I want to price myself.",
        quote:
          "Anything over about $25,000 I want to price myself. And anything in solid surface, I do not care what it costs, that material will eat you alive if you are not careful.",
        speaker: "Dana Whitfield",
        timestamp: "05:01",
        owner: "Dana Whitfield",
      },
    ],
    tasks: [
      {
        task: "I can do next Tuesday and the Thursday after.",
        quote: "I can do next Tuesday and the Thursday after.",
        speaker: "Dana Whitfield",
        timestamp: "08:50",
        owner: "Dana Whitfield",
        flowStepId: "flow_demo_2",
      },
    ],
    canvasUpdates: call2CanvasUpdates(),
    flowConfirmations: [
      {
        flowStepId: "flow_demo_2",
        status: "confirmed",
        quote:
          "That is it. That is exactly it. The hour of work is not the problem. It is the eight days it sits before I get to the hour.",
        speaker: "Dana Whitfield",
        timestamp: "01:38",
      },
      {
        flowStepId: "flow_demo_3",
        status: "unconfirmed",
        quote: "",
        speaker: "",
        timestamp: "",
      },
      {
        flowStepId: "flow_demo_4",
        status: "corrected",
        quote:
          "She does not. That is my fault, I said it badly last time. Priya does the casework drawings. Terry does the fixture drawings, the display work, anything going into a store rollout. It is maybe sixty-forty.",
        speaker: "Dana Whitfield",
        timestamp: "02:40",
      },
      {
        flowStepId: "flow_demo_5",
        status: "confirmed",
        quote:
          "Drawings. Same as Dana said. There is no version of more work where drawings do not back up first, because approvals are not in our control. The architect sits on it for a week and we cannot start cutting.",
        speaker: "Terry Nakamura",
        timestamp: "07:34",
      },
    ],
    roles: demoRoles(),
    analysisMode: "deterministic",
    modelStatus: "not-configured",
    speakerSummary: speakerSummary(lines),
  };
}

export function demoTranscriptSynthesis(): TranscriptSynthesis[] {
  return [call1Synthesis(), call2Synthesis()];
}

/**
 * The findings call as a model would have to return it under the strict transcript schema —
 * every span, role, baseline nomination and rival populated, and every one of them a literal
 * substring of a line that is already in `CALL_2`.
 *
 * It exists so the grounding layer can be exercised against the real practice transcript
 * rather than a toy one: a payload that is honest about this call must survive grounding
 * intact, and each demonstrated exploit must be reachable by changing one field of it.
 */
export function demoModelPayload(): Record<string, unknown> {
  const line = (fragment: string) => lineNumberIn(2, fragment);
  return {
    narrative:
      "The owner confirms the nine-day figure against her own reading of the log, rules out capacity herself, and names the pricing knowledge in her head as the thing the number waits on.",
    constraint: {
      constraint_type: "knowledge",
      canvas_block: "Key Resources",
      reasoning:
        "Every quote waits on one person to price it. The pricing work is an hour; the queue in front of it is eight days.",
      symptom_vs_constraint:
        "The nine-day turnaround is the symptom. The constraint is that the pricing knowledge exists in one head and nowhere else, so nothing can move without that head.",
      prescription: "A one-page price book for the recurring assemblies, written and owned by the owner.",
      why_smallest_intervention: "It hires nobody, buys nothing, and changes no system.",
      kill_condition: "Quotes go out in three days and the win rate does not move.",
      predicted_next_constraint: "Shop drawings and architect approval time.",
      evidence: [
        {
          line: line("It is the eight days it sits before I get to the hour"),
          quote: "It is the eight days it sits before I get to the hour.",
          role: "symptom",
        },
        {
          line: line("The thing that makes the number is in my head"),
          quote: "The thing that makes the number is in my head and nowhere else.",
          role: "mechanism",
        },
        {
          line: line("It is 9 days per quote"),
          quote: "It is 9 days per quote, yes.",
          role: "magnitude",
        },
        {
          line: line("It is my book"),
          quote: "It is my book.",
          role: "single_point_dependency",
        },
      ],
      baseline_metric_index: 0,
      baseline_reason:
        "Quote turnaround is the interval the pricing dependency creates: the enquiry sits in the queue in front of the owner's hour of work, and Rosa's log measures exactly that interval, from the day it is logged to the day it goes out.",
    },
    rejected_hypotheses: demoRejectedHypotheses().map((item) => ({
      constraint_type: item.constraintType,
      canvas_block: item.canvasBlock,
      reason: item.reason,
      line: item.line,
      quote: item.quote,
    })),
    quotes: [
      {
        line: line("It is 9 days per quote"),
        quote: "It is 9 days per quote, yes.",
        reason: "Owner confirms the baseline against her own reading of the log.",
      },
    ],
    metrics: [
      {
        line: line("It is 9 days per quote"),
        quote: "It is 9 days per quote, yes.",
        label: "Quote turnaround time",
        value: "9",
        unit: "days",
        period: "per quote",
        unit_span: "days",
        period_span: "per quote",
        denominator_span: "",
      },
    ],
    contradictions: [],
    canvas_updates: [],
    flow_confirmations: [],
    decisions: [],
    tasks: [],
    roles: [],
    unanswered_required_question_ids: [],
    gaps: [],
  };
}

/* ------------------------------------------------------------------ *
 * The engagement
 * ------------------------------------------------------------------ */

const DEMO_NOTES = `${DEMO_OWNER_MARKER}.

Meridian Millwork is not a real company. Dana Whitfield, Rosa Alvarez, Priya Shah, Terry Nakamura and Miles Okonkwo do not exist, and every transcript line, quote, number and document in this record was written as training material. Nothing here may be sent to a client, pasted into a proposal, quoted to a prospect, or reused as evidence for any real engagement.

Use it to practise the whole arc: research, readiness brief, discovery call, synthesis, findings call, diagnosis, sprint, measured outcome, catalog. Delete it whenever you like; it can always be rebuilt exactly as it is.`;

export function buildDemoEngagement(ownerId: string, now: string): Engagement {
  const finding = demoFinding();
  return {
    id: demoEngagementIdFor(ownerId),
    ownerId,
    client: DEMO_CLIENT_NAME,
    website: DEMO_WEBSITE,
    primaryContact: "Dana Whitfield",
    primaryContactRole: "Owner",
    email: DEMO_CONTACT_EMAIL,
    advisor: DEMO_ADVISOR,
    stage: "Sprint & Catalog",
    status: "Closed",
    workflowState: "CATALOG_WRITTEN",
    nextAction: "Practice run complete — reset it, or open the next constraint at shop drawings",
    dueDate: null,
    lastContact: MEASURED_AT,
    call1At: CALL_1_AT,
    call2At: CALL_2_AT,
    readinessBriefStatus: "Sent",
    readinessBriefSentAt: BRIEF_SENT_AT,
    baselineStatus: "Confirmed",
    engagementFolder: DEMO_OWNER_MARKER,
    notes: DEMO_NOTES,
    findingStatus: "approved",
    data: {
      practiceMode: DEMO_OWNER_MARKER,
      sourceRegister: demoSourceRegister(),
      research: demoResearch(),
      canvas: demoCanvas(),
      valueFlow: demoValueFlow(),
      baseline: demoBaseline(),
      finding,
      roles: demoRoles(),
      transcriptSynthesis: demoTranscriptSynthesis(),
      approvedReadinessBrief: {
        documentId: "doc_demo_readiness_brief",
        approvedAt: BRIEF_APPROVED_AT,
        approvedBy: DEMO_ADVISOR,
      },
      recordingConsent: {
        call1: {
          grantedBeforeCapture: true,
          attestedBy: DEMO_ADVISOR,
          attestedAt: CALL_1_AT,
          note: "Consent asked and given on the recording at 00:00 by Dana Whitfield and Rosa Alvarez (practice data).",
        },
        call2: {
          grantedBeforeCapture: true,
          attestedBy: DEMO_ADVISOR,
          attestedAt: CALL_2_AT,
          note: "Consent asked and given on the recording at 00:00 by Dana Whitfield (practice data).",
        },
      },
      sprint: demoSprint(),
      outcome: demoOutcome(),
      catalogEntry: demoCatalogEntry(),
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ *
 * Artifacts and activities
 * ------------------------------------------------------------------ */

const PRACTICE_FOOTER = `\n\n---\n\n_${DEMO_OWNER_MARKER}. Meridian Millwork is fictional and every quote in this document was written as training material._\n`;

function researchBriefMarkdown(research: ResearchSynthesis): string {
  return [
    `# ${research.title}`,
    "",
    research.description,
    "",
    "## Research mode",
    "",
    "Deterministic website extraction. No model provider was configured, and none is needed for this record.",
    "",
    "## Known public facts",
    "",
    research.facts.map((item) => `- ${item.statement}${item.sourceUrl ? ` — ${item.sourceUrl}` : ""}`).join("\n"),
    "",
    "## Proposed value flow (unconfirmed)",
    "",
    (research.valueFlow ?? [])
      .map((step) => `${step.order}. ${step.name} — ${step.actor || "actor unknown"} _(${step.evidenceStatus})_`)
      .join("\n"),
    "",
    "## Missing",
    "",
    research.gaps.map((gap) => `- ${gap}`).join("\n"),
  ].join("\n");
}

function synthesisMarkdown(synthesis: TranscriptSynthesis): string {
  return [
    `# Call ${synthesis.callNumber} Synthesis`,
    "",
    "## Evidence quotes",
    "",
    synthesis.quotes.map((item) => `- [${item.timestamp}] ${item.speaker}: "${item.text}"`).join("\n") ||
      "- No client-stated constraint evidence detected.",
    "",
    "## Contradictions with public research",
    "",
    (synthesis.contradictions ?? [])
      .map(
        (item) =>
          `- ${item.resolution}: research said "${item.researchStatement}"; client said "${item.clientQuote}" (${item.speaker}, ${item.timestamp})`,
      )
      .join("\n") || "- None detected.",
    "",
    "## Decisions",
    "",
    (synthesis.decisions ?? []).map((item) => `- ${item.decision} — ${item.owner || item.speaker}`).join("\n") ||
      "- None recorded.",
    "",
    "## Baseline",
    "",
    synthesis.baselineStatus,
    "",
    "## Gaps",
    "",
    synthesis.gaps.map((gap) => `- ${gap}`).join("\n") || "- None detected.",
  ].join("\n");
}

export interface DemoArtifact {
  kind: string;
  title: string;
  status: string;
  provenance: string;
  content: string;
  data?: unknown;
}

/**
 * Every document the arc would have produced, in the order it would have produced them,
 * generated by the same builders the live workflow uses.
 */
export function demoArtifacts(engagement: Engagement): DemoArtifact[] {
  const finding = (engagement.data.finding as ConstraintFinding | undefined) ?? demoFinding();
  const research = (engagement.data.research as ResearchSynthesis | undefined) ?? demoResearch();
  const synthesis = Array.isArray(engagement.data.transcriptSynthesis)
    ? (engagement.data.transcriptSynthesis as TranscriptSynthesis[])
    : demoTranscriptSynthesis();
  const sprint = (engagement.data.sprint as SprintRecord | undefined) ?? demoSprint();
  const outcome = (engagement.data.outcome as OutcomeMeasurement | undefined) ?? demoOutcome();
  const catalogEntry = (engagement.data.catalogEntry as CatalogEntry | undefined) ?? demoCatalogEntry();
  const agenda = generateFindingsAgenda(engagement, finding);
  const call1 = synthesis.find((entry) => entry.callNumber === 1) ?? demoTranscriptSynthesis()[0];
  const call2 = synthesis.find((entry) => entry.callNumber === 2) ?? demoTranscriptSynthesis()[1];
  const client = engagement.client || DEMO_CLIENT_NAME;

  const documents: DemoArtifact[] = [
    {
      kind: "company_brief",
      title: `${client} — Public Research Brief`,
      status: "draft",
      provenance: "public-research",
      content: researchBriefMarkdown(research),
      data: research,
    },
    {
      kind: "readiness_brief",
      title: `${client} - Pre-Call Readiness Brief`,
      status: "approved",
      provenance: "advisor-note",
      content: generateReadinessBrief(engagement, {
        videoLink: "https://meet.example.com/practice-meridian",
        duration: "60 minutes",
      }),
      data: { videoLink: "https://meet.example.com/practice-meridian", duration: "60 minutes" },
    },
    {
      kind: "synthesis_diff",
      title: `${client} — Call 1 Synthesis`,
      status: "needs_review",
      provenance: "advisor-note",
      content: synthesisMarkdown(call1),
      data: call1,
    },
    {
      kind: "findings_agenda",
      title: `${client} — Findings Call Agenda`,
      status: "draft",
      provenance: "advisor-note",
      content: agenda.markdown,
      data: { sections: agenda.sections },
    },
    {
      kind: "transcript_reconciliation",
      title: `${client} — Call 2 Synthesis`,
      status: "needs_review",
      provenance: "advisor-note",
      content: synthesisMarkdown(call2),
      data: call2,
    },
    {
      kind: "diagnosis_package",
      title: `${client} — Diagnosis Package`,
      status: "approved",
      provenance: "advisor-note",
      content: generateDiagnosisPackage(engagement, finding),
      data: { findingStatus: finding.findingStatus },
    },
    {
      kind: "audit_report",
      title: `${client} — Audit Report`,
      status: "approved",
      provenance: "advisor-note",
      content: generateAuditReport(engagement, finding),
      data: { findingStatus: finding.findingStatus },
    },
    {
      kind: "proposal",
      title: `${client} — Fixed-Sprint Proposal`,
      status: "approved",
      provenance: "advisor-note",
      content: generateProposal(engagement, finding),
      data: { findingStatus: finding.findingStatus },
    },
    {
      kind: "implementation_roadmap",
      title: `${client} — Implementation Roadmap`,
      status: "approved",
      provenance: "advisor-note",
      content: generateRoadmap(engagement, finding),
      data: { findingStatus: finding.findingStatus },
    },
    {
      kind: "developer_spec",
      title: `${client} — Third-Party Developer Specification`,
      status: "approved",
      provenance: "advisor-note",
      content: generateDeveloperSpec(engagement, finding),
      data: { findingStatus: finding.findingStatus },
    },
    {
      kind: "roles_map",
      title: `${client} — Roles & Responsibility Map`,
      status: "approved",
      provenance: "advisor-note",
      content: generateRolesMap(engagement, finding),
      data: { findingStatus: finding.findingStatus },
    },
    {
      kind: "sprint_plan",
      title: `${client} — Sprint 1 Plan`,
      status: "approved",
      provenance: "advisor-note",
      content: generateSprintPlan(engagement, finding, sprint),
      data: sprint,
    },
    {
      kind: "outcome_report",
      title: `${client} — Measured Outcome`,
      status: "approved",
      provenance: "advisor-note",
      content: generateOutcomeReport(engagement, finding, outcome),
      data: outcome,
    },
    {
      kind: "catalog_entry",
      title: `${client} — Catalog Entry`,
      status: "approved",
      provenance: "advisor-note",
      content: generateCatalogEntry(engagement, finding, catalogEntry),
      data: catalogEntry,
    },
  ];

  // Every practice document says so on its own face, in case one is ever printed or shared.
  return documents.map((document) => ({ ...document, content: `${document.content}${PRACTICE_FOOTER}` }));
}

export function demoActivities(): Array<{
  activityType: string;
  summary: string;
  outcome: string;
  nextAction: string;
}> {
  return [
    {
      activityType: "Client",
      summary: "Created the practice engagement for Meridian Millwork",
      outcome: "Fictional training record; nothing in it describes a real company",
      nextAction: "Research this business",
    },
    {
      activityType: "Research",
      summary: `Researched ${DEMO_WEBSITE}`,
      outcome: "10 public facts labeled public-research, 6 gaps recorded, 3 constraint hypotheses proposed",
      nextAction: "Review research gaps and draft the pre-call readiness brief",
    },
    {
      activityType: "Brief",
      summary: "Approved the pre-call readiness brief",
      outcome: "Brief bound to the engagement as immutable; send intent created and approved separately",
      nextAction: "Run the discovery call",
    },
    {
      activityType: "Transcript",
      summary: "Processed the Call 1 discovery transcript",
      outcome: "Baseline Confirmed at 9 days per quote from the client's own log; finding provisional",
      nextAction: "Review synthesis and explicitly approve the Canvas commit",
    },
    {
      activityType: "Canvas",
      summary: "Approved the Canvas commit",
      outcome: "Nine blocks carry client-stated evidence; the 48-hour quote claim from the website is superseded",
      nextAction: "Build the findings call agenda",
    },
    {
      activityType: "Findings",
      summary: "Built the findings call agenda",
      outcome: "Six sections; every quote on the evidence page is client-stated",
      nextAction: "Run the findings call",
    },
    {
      activityType: "Transcript",
      summary: "Processed the Call 2 findings transcript",
      outcome: "Owner confirmed the baseline and corrected who draws shop drawings; finding client-verified",
      nextAction: "Review reconciliation and explicitly approve the diagnosis",
    },
    {
      activityType: "Synthesis",
      summary: "Approved diagnosis checkpoint",
      outcome: "Finding approved with a named human owner, Dana Whitfield (Owner), and a confirmed baseline",
      nextAction: "Generate the approved deliverable suite",
    },
    {
      activityType: "Deliverables",
      summary: "Generated deliverable suite",
      outcome: "6 internal documents generated; no external write performed",
      nextAction: "Activate Sprint 1",
    },
    {
      activityType: "Sprint",
      summary: "Activated Sprint 1",
      outcome: "Measurement clock started against the confirmed baseline of 9 days per quote",
      nextAction: "Run the sprint, then measure the ending metric",
    },
    {
      activityType: "Measurement",
      summary: "Recorded the measured outcome",
      outcome: "Delta -6 days (decreased; improved) on quote turnaround; constraint moved to shop drawings",
      nextAction: "Write the reusable pattern to the catalog",
    },
    {
      activityType: "Catalog",
      summary: "Wrote the reusable pattern to the catalog",
      outcome: "Owner-held pricing knowledge as a queue, with the measured result attached to this engagement only",
      nextAction: "Practice run complete — reset it, or open the next constraint at shop drawings",
    },
  ];
}
