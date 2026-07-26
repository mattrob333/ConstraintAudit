---
type: Testing Guide
title: Verification and Quality Gates
description: Automated tests, the exercised end-to-end browser story, evidence-safety expectations, and remaining missing coverage for the Tier 4 Advisor Cockpit.
tags: [testing, verification, e2e, governance]
---

# Verification and quality gates

## Current automated suite

As of the 2026-07-26 gap-closure change:

- `npm run lint` passes;
- `npx tsc --noEmit` passes;
- the vinext production build succeeds;
- two rendered-frontend tests pass (`tests/rendered-html.test.mjs`);
- 26 backend tests pass — 15 in `tests/backend-workflow.test.mjs` and 11 in `tests/gap-closure.test.mjs`.

### Backend workflow coverage

Research fallback, source-backed Canvas facts, public-URL safety, transcript provenance, metric extraction, provisional findings, readiness-artifact binding, diagnosis evidence, consent, command boundaries, DNS and redirect safety, and response-size limits.

### Gap-closure coverage

| Test | What it locks down |
| --- | --- |
| Canonical canvas is actually populated from research | `runResearch()` writes `engagement.data.canvas`, closing the Missing-blocks defect |
| Client evidence supersedes research without destroying it | Superseded research claims are downgraded and labelled, not deleted |
| Merging a canvas never downgrades client evidence | Provenance rank is respected across merges |
| Research proposes a flow and anchored questions with no API key | The deterministic path alone produces `valueFlow` and `discoveryQuestions` |
| Research fallback refuses to invent a flow it cannot see | An unreadable page yields `gap` steps, not fabricated ones |
| VTT and SRT decode into speaker-attributed lines | `lib/transcript-files.ts` cue parsing |
| Uploaded transcript files carry real content, not a filename | The filename-only upload defect stays fixed |
| A measured change is never called an improvement without `improvedWhen` | `interpretation` stays `not-interpreted` |
| A delta is blocked rather than invented | Unconfirmed baseline, non-numeric reading, or incomparable units each produce a blocked reason |
| Rendered document HTML escapes content instead of executing it | `renderMarkdownToHtml()` injection safety |

## Manually exercised end-to-end story

The full workflow was exercised against a running dev server: intake → research → VTT upload → canvas commit → call 2 → diagnosis approval → deliverables → sprint → outcome → catalog, plus tenant isolation and intent gating. Record this as live browser evidence, not as automated coverage.

## Remaining missing coverage

The automated suite still does not prove:

- any Google, Resend, PandaDoc, Exa, Firecrawl, or Apollo adapter succeeds against a live provider (the adapters are exercised only through their `not-configured` path);
- tenant isolation, as an automated assertion rather than a manual check;
- the sprint → outcome → catalog sequence end to end in code;
- DOCX decoding, as distinct from the VTT and SRT cases that are covered;
- model-assisted transcript synthesis, which does not exist.

## Required browser story

For research-to-call changes, test a cold engagement:

1. enter company and URL;
2. run research;
3. inspect retained sources and all nine Canvas blocks;
4. inspect the proposed value flow and the private question set, and confirm neither is a generic fallback;
5. approve the readiness brief;
6. confirm recording consent;
7. verify the live questions match the current engagement;
8. upload or import a real transcript file, not pasted text;
9. verify client quotes, contradictions, and Canvas updates;
10. approve the Canvas commit;
11. complete Call 2 reconciliation and confirm Call 1 evidence survives;
12. verify the provisional/confirmed baseline rule;
13. generate deliverables and confirm the Audit Report renders the same Canvas the advisor reviewed;
14. open a deliverable with `?format=html` and confirm the printable rendering;
15. activate the sprint, record an ending metric, and confirm the delta is either computed from two comparable confirmed readings or explicitly blocked;
16. write the catalog entry;
17. create an intent, confirm nothing is sent on creation, approve it, and execute it.

Run the story for at least two contrasting companies and compare the flows and questions.

## Failure paths

Every relevant slice must test:

- OpenAI unavailable;
- insufficient or unsupported public sources;
- unsafe URL or redirect;
- an unreadable or malformed transcript file;
- missing consent;
- unknown or advisor speaker lines;
- missing baseline;
- missing human owner;
- stale approval or artifact version;
- executing an intent that was never approved;
- executing against an unconfigured provider (must return `not-configured`, attempt no call, and stay approved);
- duplicate external-action retry;
- cross-owner access, which must be indistinguishable from a missing record.

## Reporting completion

A passing unit test does not prove a client workflow is usable. Report automated gates and live browser evidence separately, and record remaining boundaries in `DEVELOPMENT_LOG.md`. Do not describe an adapter as working on the strength of a `not-configured` test.
