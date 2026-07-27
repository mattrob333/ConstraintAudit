---
type: Testing Guide
title: Verification and Quality Gates
description: The automated suite and its exact composition, what each file locks down, the exercised browser story, and the coverage that is still missing.
tags: [testing, verification, e2e, governance]
---

# Verification and quality gates

## Current automated suite

As of the 2026-07-27 update, verified by reading `package.json` and every file in `tests/`:

- `npm run lint` and `npx tsc --noEmit` are the declared gates alongside `npm test`;
- the vinext production build runs first and is not optional — the rendered-HTML suite asserts against `dist/server/index.js`;
- `node --test` runs `tests/rendered-html.test.mjs`: **3 tests**;
- `tsx --test` then runs five files in this order: `backend-workflow` (**16**), `gap-closure` (**11**), `reasoning` (**7**), `practice-mode` (**7**), `bug-review` (**6**) — **47 tests**.

**50 tests in total.** Every one is a flat top-level `test()` from `node:test`; there are no `describe` blocks, no nested subtests, and nothing skipped or `.only`.

| File | Runner | Tests |
| --- | --- | --- |
| `tests/rendered-html.test.mjs` | `node --test` | 3 |
| `tests/backend-workflow.test.mjs` | `tsx --test` | 16 |
| `tests/gap-closure.test.mjs` | `tsx --test` | 11 |
| `tests/reasoning.test.mjs` | `tsx --test` | 7 |
| `tests/practice-mode.test.mjs` | `tsx --test` | 7 |
| `tests/bug-review.test.mjs` | `tsx --test` | 6 |

### Rendered-frontend coverage

The build contains the audit entry point and the expected cockpit strings, and the walkthrough carries no retired coaching content (`CallBriefing`, `ifYouGetLost`); the crash screen renders no exception message, digest, stack, or class name to a client; and the owned client surface keeps its workflow gates and accessibility — the `<AdvisorCockpit />` mount, a typed `/api/engagements` call, no local fallback engagements, the consent-status union, send-intent approval copy, ARIA attributes, and the CSS grid and reduced-motion rules.

### Backend workflow coverage

Research fallback, source-backed Canvas facts, public-URL safety, transcript provenance, metric extraction, provisional findings, readiness-artifact binding, diagnosis evidence, consent, patch-command boundaries, DNS and redirect safety, and response-size limits.

### Gap-closure coverage

| Test | What it locks down |
| --- | --- |
| Canonical canvas is actually populated from research | `runResearch()` writes `engagement.data.canvas` |
| Client evidence supersedes research without destroying it | Superseded research claims are downgraded and labelled, not deleted |
| Merging a canvas never downgrades client evidence | Provenance rank is respected across merges |
| Research proposes a flow and anchored questions with no API key | The deterministic path alone produces `valueFlow` and `discoveryQuestions` |
| **Two different companies produce materially different flows and questions** | A fabricator and a dental clinic yield non-identical flow-step names and question sets while both still cover every discovery section |
| Research fallback refuses to invent a flow it cannot see | An unreadable page yields `gap` steps with no sources |
| VTT and SRT decode into speaker-attributed lines | `lib/transcript-files.ts` cue parsing |
| Uploaded transcript files carry real content, not a filename | The filename-only upload defect stays fixed |
| A measured change is never called an improvement without `improvedWhen` | `computeMetricDelta()` leaves `interpretation` at `not-interpreted` |
| A delta is blocked rather than invented | Unconfirmed baseline, non-numeric reading, or incomparable units each produce a stated reason |
| Rendered document HTML escapes content instead of executing it | `renderMarkdownToHtml()` injection safety |

### Reasoning coverage

| Test | What it locks down |
| --- | --- |
| Metric direction is inferred for the obvious cases | Nine name/unit/period cases each resolve as expected, with a non-empty basis and a non-advisor source |
| The advisor always outranks the inference | `advisorDeclared` overrides the unit heuristic; `source: "advisor"`, confidence 1 |
| An unreadable metric asks rather than guesses | Empty metric returns `improvedWhen: null`, `source: "none"`, and does not throw |
| Direction decides improved vs worsened; arithmetic is unchanged | 3 → 1 days is `decreased` in every case; only the interpretation moves |
| **A fabricated client quote is rejected, not printed** | `groundModelSynthesis()` keeps the verbatim quote, drops the invented one, and records it in `rejections` |
| **The model cannot promote an advisor line into client evidence** | An advisor-spoken quote yields zero kept quotes and at least one rejection |
| **Grounded quotes are rewritten from the transcript, not from the model** | A paraphrase matches, but speaker and timestamp come from the real line, overriding the model's |

### Practice-mode coverage

Determinism across two builds and distinct per-owner ids; the data being unmistakably fake and saying so; every quote the diagnosis rests on appearing verbatim in a real transcript line; more than ten advisor lines all parsing as `advisor-note` with none reaching the finding's evidence; the findings agenda reading back only figures that bear on the constraint; artifacts generating real content across the whole arc; and the measured outcome reading as an improvement from inference alone, with `directionInference.source` asserted **not** to be `"advisor"`.

That last test is the automated statement of the behavior change on this page: the app can now interpret a delta without the advisor, and the suite pins that it records how it got there.

### Bug-review coverage

The six regressions found in code review and fixed: a model value grounds only against a whole number in the cited line, never a substring of a longer one; magnitude suffixes are read, so a revenue drop is not called an improvement; a range value can anchor neither a delta nor a confirmed baseline; a millisecond timestamp does not corrupt the parsed speaker; a VTT cue without milliseconds is not silently dropped; and the generic workflow advance cannot reach an evidence-gated state.

## Manually exercised end-to-end story

The full workflow was exercised against a running dev server: intake → research → VTT upload → canvas commit → call 2 → diagnosis approval → deliverables → sprint → outcome → catalog, plus tenant isolation and intent gating. Record this as live browser evidence, not as automated coverage.

## Remaining missing coverage

The automated suite still does not prove:

- **any adapter succeeds against a live provider.** Google, Resend, PandaDoc, Exa, Firecrawl, and Apollo are exercised only through their `not-configured` path, and the last four have no adapter at all;
- **`lib/access-jwt.ts` works.** No test imports it. Signature verification, JWKS caching, key rotation, claim checks, and the `denied` auth mode are entirely unproven in code, and no live Cloudflare Access sign-in is evidenced in this repository;
- **tenant isolation**, as an automated assertion rather than a manual check;
- **the sprint → outcome → catalog sequence** end to end in code;
- **the model transcript pass itself.** `groundModelSynthesis()` is well covered, but `synthesizeTranscriptWithOpenAI()` — the HTTP call, the failure fallbacks, and `merge()` — is not. The union merge, the constraint-disagreement gap, and the rule that the model cannot grant `client-verified` are all untested;
- **tier 4 of metric direction.** `inferMetricDirection()` (tiers 1–3) is covered; `resolveMetricDirection()`'s model call and its degradation path are not;
- **DOCX decoding.** `detectTranscriptFormat("call.docx")` is asserted, but the only file actually decoded end to end is a `.txt`. The ZIP + `DecompressionStream` path is untested;
- **source-document ingest**, including the PDF refusal;
- **the findings-agenda action**, as distinct from the practice-mode assertion about its content;
- **`PATCH /api/engagements/:id/outcome`** and the direction correction path.

## Required browser story

For research-to-call changes, test a cold engagement:

1. enter company, contact, contact role, and URL;
2. attach a source document and confirm it lands in the register as `doc`; try a PDF and confirm the refusal;
3. run research;
4. inspect retained sources and all nine Canvas blocks;
5. inspect the proposed value flow and the private question set, and confirm neither is a generic fallback;
6. approve the readiness brief;
7. confirm recording consent;
8. verify the live questions match the current engagement, open the coaching rail, then press `Escape` and confirm the rail is gone from the DOM, not merely hidden;
9. upload or import a real transcript file, not pasted text;
10. verify client quotes, contradictions, and Canvas updates; check `analysisMode`, the model status note, the narrative's advisor-note labelling, and the grounding-rejection list;
11. approve the Canvas commit;
12. build the findings agenda and open the presentation view; confirm no advisor-only content is reachable from it;
13. complete Call 2 reconciliation and confirm Call 1 evidence survives;
14. verify the provisional/confirmed baseline rule;
15. generate deliverables, confirm **six** artifacts including the Roles & Responsibility Map, and that the Audit Report renders the same Canvas the advisor reviewed;
16. open a deliverable with `?format=html` and confirm the printable rendering;
17. activate the sprint, record an ending metric, watch the direction preview update as you type, and confirm the delta is either computed from two comparable confirmed readings or explicitly blocked;
18. correct the direction and confirm the numbers did not move but the interpretation and the recorded source did;
19. write the catalog entry;
20. create an intent, confirm nothing is sent on creation, approve it, and execute it.

Run the story for at least two contrasting companies and compare the flows and questions. Practice mode is a fast way to see the shape of the arc first, but it exercises none of the network paths above.

## Failure paths

Every relevant slice must test:

- OpenAI unavailable, for research and for transcript synthesis separately;
- a model response that cites a line that does not exist, is not client-stated, or does not contain the quoted span;
- insufficient or unsupported public sources;
- unsafe URL or redirect;
- an unreadable or malformed transcript file, and a PDF offered as a source document;
- missing consent;
- unknown or advisor speaker lines;
- missing baseline;
- missing human owner;
- a metric whose direction is genuinely ambiguous;
- stale approval or artifact version;
- executing an intent that was never approved;
- executing against an unconfigured provider (must return `not-configured`, attempt no call, and stay approved);
- duplicate external-action retry;
- an absent, malformed, or wrong-audience Access assertion;
- exactly one `CF_ACCESS_*` binding set while `REQUIRE_ADVISOR_AUTH` is on;
- cross-owner access, which must be indistinguishable from a missing record.

## Reporting completion

A passing unit test does not prove a client workflow is usable. Report automated gates and live browser evidence separately, and record remaining boundaries in `DEVELOPMENT_LOG.md`. Do not describe an adapter as working on the strength of a `not-configured` test, and do not describe the identity boundary as verified on the strength of code review alone.
