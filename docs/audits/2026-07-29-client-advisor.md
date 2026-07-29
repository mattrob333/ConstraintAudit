# Product audit — the paying client and the working advisor

**Date:** 2026-07-29 · **Method:** all 14 practice deliverables rendered from `lib/demo.ts` +
`lib/deliverables.ts` and read as the client; workflow walked through `AdvisorCockpit.tsx`,
`lib/actions.ts`, `lib/workflow.ts`, `lib/transcript.ts` as the advisor. Roadmap distilled from
this report lives in `docs/FINISH_LINE.md`.

**Headline:** the practice engagement is a beautiful, hand-written sales asset that the software
cannot reproduce — most of what makes the Meridian documents persuasive is literal prose in
`lib/demo.ts`, not pipeline output. Separately, a seasoned advisor cannot change a single word of
the diagnosis the model produces. Those two facts, together, are the product.

## Tier 1 — blocks a real sale or a real engagement

### C1. The advisor cannot edit the diagnosis. At all. (Fix: M)
`updateFinding()` (`lib/actions.ts:453`) accepts exactly `humanOwner` and `baseline`; the cockpit
sends only `humanOwner`. Constraint type, canvas block, prescription wording, kill condition,
predicted next constraint, appendix, and evidence selection are machine-authored and immutable,
flowing verbatim into every client document. An advisor who disagrees has one lever: refuse to
approve, and the engagement stops. This is the single largest reason a real advisor abandons the
tool after one live client.
**Fix:** extend `updateFinding` + an "Edit the finding" panel; record every advisor edit as
`advisor-note` provenance beside the model's original.

### C2. The practice example massively oversells a real engagement (Fix: M–L)
With no `OPENAI_API_KEY`, the deterministic path (`lib/transcript.ts:23-52, 746-769`) produces:
one of five canned prescription strings; a fixed why-smallest-intervention sentence; a generic
predicted-next-constraint; a circular kill condition; `appendixItems: []` always; and no roles map
at all (`generateRolesMap()` → empty). `symptoms` = raw quote echoes, so the findings presentation
prints the same quotes twice ("What we heard" and "Your own words"). Even with a key, model
synthesis has never been run against a real client transcript (`NEXT_STEPS.md:144`). Advisors are
trained on Practice mode and will sell Meridian-quality output; reality delivers canned strings.
That is a refund conversation.
**Fix:** close the gap (interpretive symptoms, populated appendix, key-gated diagnosis) and/or
put a one-line banner on practice mode naming which parts a real run reproduces.

### C3. Two client-facing sections are structurally always empty (Fix: S)
`appendixItems` is written `[]` at `lib/transcript.ts:769` and `lib/openai-transcript.ts:605` and
has no writer anywhere. Diagnosis package prints "Not the constraint — None recorded"; proposal
prints "Explicitly out of scope — Nothing else has been deferred in writing yet" — a commercially
dangerous sentence in a fixed-fee proposal. In the practice version this section is five sharp
lines that do more selling than anything else.
**Fix:** the rejected constraint candidates *are* the appendix — capture them during synthesis,
plus an advisor free-text field.

### C4. "Client refuses recording" is an unrecoverable dead end (Fix: M)
"Continue without recording" is offered (`AdvisorCockpit.tsx:2771, 2817`), then `analyze()` refuses
without consent and diagnosis approval is disabled. A client who says "no recording, take notes" —
routine for regulated buyers — kills the engagement permanently, mid-call.
**Fix:** an advisor-attested notes path producing `advisor-note` evidence, a finding stamped
"unrecorded call — evidence is advisor-attested", and documents that say so on their face.

### C5. Sixty minutes of guided-call typing is discarded (Fix: S persist / M use)
`answers`, `notes`, `values` are `useState` maps cleared by `resetEngagementState()`; they appear
in no save call and never reach synthesis, the Canvas, the finding, or any document. The
highest-effort screen in the product produces nothing, and evidence typed into it silently
vanishes on refresh.
**Fix:** persist on blur; feed captured numbers to the baseline candidate and notes to the gap
register.

### C6. "Send to client" does not send to the client (Fix: M)
`INTENT_TYPES` (`lib/workflow.ts:76`) supports emailing only the readiness brief. The proposal —
the artifact the product exists to produce — publishes to a Google Drive the client cannot see, or
nothing. **Fix:** a `deliverable_send` intent on the existing Resend adapter, same approval gate.

### C7. The proposal is not signable and reads as unproofed (Fix: S ×4)
(a) "Your numbers, as you stated them" prints 21 unfiltered lines including the website's age, an
ex-employee's tenure, and a two-week holiday — `generateProposal` uses `clientStatedNumbers`
(`lib/deliverables.ts:421`) while the correctly filtered `constraintRelevantNumbers` (`:226`)
exists and is used only by the findings agenda; entries are malformed ("20% percent", "9 days
quote", "$25,000 dollars"). (b) A broken sentence: the measurement-clock interpolation (`:456`)
produces a capital mid-sentence and a double period. (c) "Likelihood" is a static string (`:451`)
exactly where the buyer asks "will this work?". (d) No date, validity, terms, or signature block.
**On the no-ROI stance:** right principle, currently a refusal. Hand the owner their own
arithmetic — their three numbers and the formula — and it becomes the close.

### C8. Printed documents are unbranded, undated, unsigned (Fix: S)
`app/api/documents/[id]/route.ts:24` renders body-only markdown. `renderDeliverableDocument()`
(`lib/deliverables.ts:1493`) — title block, client/advisor names, date, confidentiality footer —
has **zero callers**. One-line change against code that already exists.

### C9. Client quotes truncated mid-word in the audit report (Fix: S)
`lib/canvas.ts:170` — `.slice(0, 240)`, no ellipsis, no word boundary. "…but the GC sti". The
report's central claim is "we quote you exactly."

## Tier 2 — costs the renewal, the referral, or the second sale

### C10. There is no second audit for the same client (Fix: M–L)
`CATALOG_WRITTEN` is terminal; the only path to the next constraint is a fresh engagement from
intake, discarding the Canvas, flow, roles, and transcripts. Four documents sell a second sprint
the software obstructs. **Fix:** "Start the next constraint" forks a new engagement carrying
Canvas/flow/roles/finding, entering at Prepare.

### C11. The outcome report never converts days into money (Fix: S–M)
It reports "-6 days (-66.7%) improved" and stops. Two client-confirmed readings exist; the report
may honestly say "3 days instead of 9, on ~30 bids a month" and let the owner reach the rest.
Nothing in it drives a renewal or is quotable in a referral.

### C12. The audit report is a data dump, not a report (Fix: M)
Opens with canvas internals and confidence percentages; no executive summary; prints internal QA
telemetry ("11 of 21 claims are confirmed by the client" — reads as "half of this came off your
website"); appends the entire diagnosis package verbatim.

### C13. What a paying client expects and does not get (Fix: L, or S to state the boundary)
No competitive context, no peer benchmark, no visuals (a six-box flow diagram with the constraint
marked would carry the argument in one glance), no executive one-pager, no advisor identity.
Benchmarks conflict with the evidence rules — defensible, but say so in one line, or the silence
reads as an omission.

### C14. The first client touchpoint is a form letter (Fix: S)
The readiness brief interpolates nothing but the company name. Two research-derived lines ("we saw
you promise 48-hour quotes; we'd like to understand how that works") would set up the entire
engagement.

### C15. The roles map labels named employees "grind" (Fix: S)
In a document the owner may circulate. Otherwise the best deliverable in the suite. Rename in the
client-facing render: repeatable / judgment-led / mixed.

## Tier 3 — recoverable friction

### C16. Research runs exactly once, at intake, with no retry (Fix: S)
Research is invoked only inside `createEngagement` (`AdvisorCockpit.tsx:1381`); on failure the
engagement already exists — resubmitting duplicates it, resuming the orphan lands in a circular
dead end (Call → "run research" → Research screen with no run button). Both needed endpoints
already exist. **Fix:** a "Re-run research" button + corrected-website field.

### C17. The baseline cannot be typed in (Fix: S)
`updateFinding` accepts a full `baseline` object; no UI sends one. If synthesis misses the number,
the finding stays provisional forever with the number sitting in the transcript. **Fix:** a
five-field baseline editor on Findings step 1.

### C18. The developer spec generates for interventions no developer can build (Fix: S)
A paper-and-people prescription still yields a "spec" with autonomy boundaries and audit-history
requirements. **Fix:** generate only when the prescription implicates a system.

### C19. The catalog is write-only (Fix: M)
POST-only; no cross-engagement read route or browse screen. The compounding-knowledge promise has
no read side. **Fix:** `GET /api/catalog` scoped to owner + a browse screen.

### C20. The registry is a list, not a pipeline (Fix: S–M)
`call1At`/`call2At` are stored but not shown; no "due this week" view, no days-waiting on
"Waiting on client". **Fix:** surface dates and days-since-update; a needs-attention filter.

### C21. Multi-stakeholder and contact-change handling is thin (Fix: M)
Speaker roles are flat client/advisor/unknown — the CFO's number and the intern's guess carry equal
weight. Changing the contact rewrites the approved finding's owner with no handover record.
**Fix:** per-speaker titles; an explicit owner-handover action recorded as an activity.

### C22. Minor, but they show (Fix: S)
"knowledge constraint in Key Activities." leads every document — raw enum + internal vocabulary as
the first six words a client reads; map to a sentence. The findings agenda prints a bare
"(eleven)". The readiness-brief email's plain-text body is raw markdown
(`lib/actions.ts:210` → `lib/integrations/resend.ts:66-73`).

## Top 5 — distance to the finish line

1. **Make the finding editable (M).** Nothing else matters if the advisor cannot put their
   judgment into the document that carries their name. Fixes C17 free, gives C3 an escape hatch.
2. **Close the demo-to-reality gap, or stop training on the demo (M).**
3. **Fix the proposal so it can be signed (S).** Filtered numbers, the clock sentence, a real
   Likelihood section, terms + signature; wire `renderDeliverableDocument` into the print route.
4. **Make the call survivable (M).** Persist the call screen's typing; an advisor-attested
   no-recording path.
5. **Let the advisor send it, and sell the next one (M).** `deliverable_send` intent; a
   next-constraint fork.

**What is genuinely good and worth protecting:** the findings-call agenda structure; the roles
map's single-point-of-dependency analysis; the refusal to invent projections, correctly
implemented; the evidence-provenance discipline that is the product's spine. None of these
findings ask to weaken any of it — they ask to let the advisor's judgment in beside it, and to let
the software actually produce what the demo shows.
