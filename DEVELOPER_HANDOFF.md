# Tier 4 Advisor Cockpit Developer Handoff

**Handoff date:** 2026-07-26  
**Audience:** the next AI agent or developer continuing implementation  
**Branch at handoff:** `claude/repo-overview-b7tlrs`  
**Documentation handoff source:** current Git `HEAD`

## Mission

Finish the Tier 4 Advisor Cockpit as a research-adaptive, evidence-grounded client discovery and throughput-audit product.

The interface should guide an advisor and client through:

1. client intake;
2. company research;
3. Business Model Canvas and value-flow review;
4. client-specific discovery questions;
5. Call 1 and transcript evidence;
6. Findings Call and second transcript reconciliation;
7. an approved constraint finding;
8. formal reports, proposal, roadmap, and developer specification;
9. implementation measurement and catalog write-back.

Do not turn the product into a general AI-opportunity audit. It is a throughput diagnosis organized around one current constraint.

## Read these files first

1. `README.md` — current capability truth and local setup.
2. `public/docs/workflow.md` — canonical target workflow and governance rules.
3. `openwiki/quickstart.md` — source map and reading order.
4. `lib/workflow.ts` — current domain types and workflow states.
5. `lib/actions.ts` — server-side business actions and approval gates.
6. `app/components/AdvisorCockpit.tsx` — the complete current client UI.
7. `DEVELOPMENT_LOG.md` — dated decisions and verification history.

## Current implementation truth

Verified on 2026-07-26: `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` succeeds, 2 rendered-frontend tests and 25 backend tests pass, and the full workflow was exercised against a running dev server.

### Working and verified

- Fresh engagement, external migration, and resume.
- Engagements, artifacts, transcripts, activities, and intents persist in Cloudflare D1.
- Website input accepts bare domains; public URLs receive SSRF, redirect, DNS, and response-size checks.
- OpenAI Responses API web search runs server-side when configured, with `store: false`, a strict schema, and retained source URLs.
- Research produces a company-specific `valueFlow` and `discoveryQuestions`, deterministically with no API key and enriched when the key is present.
- One canonical Business Model Canvas is written by research and corrected by client evidence. The audit report reads that Canvas.
- The Flow of Work screen, the research question set, and the guided call script are all generated from that engagement's research.
- Transcript upload decodes TXT, VTT, SRT, JSON, and DOCX into real speaker- and timestamp-attributed lines.
- Transcript synthesis reconciles against research and produces contradictions, Canvas corrections, flow confirmations, decisions, tasks, roles, and metrics.
- Every record is scoped to the owning advisor in SQL; a cross-owner row is indistinguishable from a missing row.
- Resend, Google Sheets, and Google Docs adapters perform real writes, reachable only from an explicitly approved intent.
- Sprint activation, outcome measurement, and catalog write-back complete the workflow.
- Both calls contain the required recording/transcription disclosure, and consent gates transcript processing.
- Missing baselines keep the finding provisional and block numeric projections.
- Diagnosis approval requires client evidence and a named human owner.

### Deliberately constrained, not missing

These behave this way on purpose. Do not "fix" them without reading the reasoning.

- **A delta is refused rather than estimated.** Two client-confirmed readings in the same unit and period, or an explicit blocked reason. See `computeMetricDelta` in `lib/workflow.ts`.
- **Improvement is never inferred.** The arithmetic direction is `increased` or `decreased`. Calling it improved or worsened requires the advisor to declare `improvedWhen`, because a shorter turnaround is a win while a smaller throughput is not.
- **Approval and execution are two decisions.** An intent is created `pending_review`, must be approved, and only then may be executed. An unconfigured provider performs no network call and leaves the intent approved so it can be retried.
- **Research can never emit `client-stated` or `doc` provenance.** A value-flow step whose source URL cannot be verified keeps the step as a proposal and downgrades it to `gap`.
- **A corrected research claim is superseded, not deleted.** Evidence is never destroyed.

### Still open

1. **Transcript synthesis is deterministic, not model-assisted.** It is keyword, overlap, and pattern based. Model-assisted analysis would improve contradiction detection and role mapping considerably. Any such change must keep the deterministic path as the offline fallback and must not let a model promote evidence provenance.

2. **No native DOCX or PDF generator.** Deliverables are Markdown plus a self-contained printable HTML rendering (`renderMarkdownToHtml`). Google Docs conversion is the current route to a formal document. A real DOCX writer would need a dependency that works on the Workers runtime.

3. **Gmail has no adapter.** Resend is the implemented sender. Apollo and PandaDoc remain connector-first contracts.

4. **Exa and Firecrawl are not implemented.** The recommended routing in README remains a proposal.

5. **Value flow is proposed, never confirmed automatically.** `flowConfirmations` records what the client spoke to, but there is no UI yet for the advisor to edit a flow step directly during the call.

## Highest-priority next slice

1. Give the advisor an in-call editor for value-flow steps, writing corrections back with `client-stated` provenance.
2. Decide whether transcript synthesis should become model-assisted, and if so specify the fallback and provenance rules before writing code.
3. Before exposing the app beyond one advisor: set `REQUIRE_ADVISOR_AUTH=1`, set `LEGACY_OWNER_EMAIL` to the real advisor, and re-verify tenant isolation against the deployed database.


## Integration sequence

| Order | Integration | Why |
| --- | --- | --- |
| 1 | Fireflies | Adapter exists; needs a key. Direct file upload now also closes this path |
| 2 | Google Sheets | Done. Writes the CRM row from an approved intent |
| 3 | Google Drive/Docs | Done. Creates the approved artifact from an approved publication intent |
| 4 | Resend | Done. Executes the approved readiness send. Gmail still has no adapter |
| 5 | PandaDoc | Next. Formal proposal/SOW drafts and signatures |
| 6 | Exa | Adds a second company-research index when OpenAI coverage is weak |
| 7 | Firecrawl | Recovers targeted sites/pages that ordinary retrieval cannot extract |
| 8 | Apollo | Optional, paid, approval-gated enrichment for a named gap |

For research routing, keep OpenAI as the current primary. Add Exa as a measurable fallback, not an assumed universal upgrade. Use Firecrawl for targeted crawling/extraction failures rather than every research run.

## Formal document target

Keep the structured engagement model as the source of truth. External formats are renderers:

```text
approved engagement model
  -> Google Docs renderer for collaborative artifacts
  -> DOCX/PDF renderer for polished reports
  -> PandaDoc renderer for proposal/SOW and signature
  -> Google Sheets renderer for CRM and catalog records
```

Recommended artifact destinations:

- Readiness Brief: Google Doc and reviewed email draft.
- Company Brief and synthesis diff: Google Docs.
- Diagnosis and Audit Report: DOCX/PDF plus editable Google Doc.
- Proposal/SOW: PandaDoc from an approved native template.
- Roadmap and developer specification: Google Doc plus optional DOCX/PDF.

## Verification expectations

Before reporting a slice complete:

1. run `npm run lint`;
2. run `npx tsc --noEmit`;
3. run `npm test`;
4. start the app with an explicit `--port` and `--strictPort`;
5. verify the actual page identity in a browser;
6. complete a cold engagement from intake through the affected checkpoint;
7. test one failure path;
8. confirm no external send/write occurred without its explicit approval;
9. record the result in `DEVELOPMENT_LOG.md`;
10. update the wiki pages affected by the change.

## Known environment and deployment facts

- Node requirement: 22.13 or newer.
- Framework: Next-compatible app built with vinext/Vite.
- Persistence: Cloudflare D1 through the `DB` binding.
- Sites project ID is stored in `.openai/hosting.json`.
- Production secret values are not in the repository.
- `.env.local` is ignored.
- The checkout currently has no Git remote configured.
- The easiest non-Sites host is Cloudflare Workers; other hosts require replacing D1 and Cloudflare runtime bindings.

## Decisions that still need the product owner

- Which identity system should govern advisors outside Sites?
- Should the first real CRM execution path use the existing Google Sheet or D1 as the canonical registry with Sheet export?
- Which Google account owns the Drive root and production OAuth client?
- Which PandaDoc template is the approved commercial template?
- What transcript retention period and deletion workflow apply?
- What per-engagement OpenAI research budget is acceptable?
- What confidence/source threshold should trigger Exa fallback?
- Should transcript synthesis use the same model as research or a separately configured model?

Do not guess these answers in code if they create external access, spending, retention, or contractual consequences.

## Handoff completion definition

The next major milestone is complete when a fresh engagement for two different real companies produces visibly different, source-grounded value flows and call plans; the advisor can edit and run those plans; a real transcript updates the same canonical Canvas; and the generated report uses that verified model without losing provenance.
