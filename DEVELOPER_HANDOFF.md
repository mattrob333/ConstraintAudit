# Tier 4 Advisor Cockpit Developer Handoff

**Handoff date:** 2026-07-25  
**Audience:** the next AI agent or developer continuing implementation  
**Repository root:** `C:\Users\mrobe\Documents\Codex\2026-07-24\sales-plugin-sales-openai-curated-remote\work\tier4-advisor-app`  
**Branch at handoff:** `main`  
**Implementation baseline commit:** `11c0fd34c796dd09ae31e11fb70cec5f23c045bc`  
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

### Working and verified

- The UI supports fresh engagement, external migration, and resuming an engagement.
- Engagements, artifacts, transcripts, activities, and intents persist in Cloudflare D1.
- Website input accepts bare domains after URL normalization.
- Public URLs receive SSRF, redirect, DNS, and response-size checks.
- OpenAI Responses API web search runs server-side when configured.
- Research uses `store: false`, a strict structured response schema, and retained source URLs.
- The Business Model Canvas screen displays source-backed research facts and explicit Missing blocks.
- The approved Pre-Call Readiness Brief excludes internal questions, Canvas v0, and suspected findings.
- Both calls contain the required recording/transcription disclosure.
- Transcript paste preserves speaker labels, timestamps, and wording when the input format is supported.
- Transcript evidence separates client, advisor, and unknown speakers.
- Missing baselines remain provisional and numeric projected deltas remain blocked.
- Canvas-commit and diagnosis approvals are explicit workflow gates.
- Diagnosis approval requires client evidence and a named human owner.
- Internal diagnosis, report, proposal, roadmap, and developer-specification artifacts can be generated.
- The current validation suite passes: lint, TypeScript, build, 2 frontend tests, and 15 backend tests.

### Partly working

- Research-tab questions use OpenAI-produced constraint metadata, but the frontend renders a generic `Could <type> be limiting <block>?` wrapper.
- Fireflies has a real backend adapter, but no key is configured in the current local environment.
- Integration-status truth exists in `/api/integrations`, but the Integration Center UI renders hardcoded statuses for everything except OpenAI.
- Documents are persisted and readable inside the app, but they are Markdown records rather than formal external documents.

### Not implemented or defective

1. **Value flow is static.**
   - `AdvisorCockpit.tsx` renders the same six flow stages for every company.
   - The research schema contains no `valueFlow` field.

2. **The guided client-call script is static.**
   - `callTopics` in `AdvisorCockpit.tsx` contains the original six demo questions.
   - The live call does not consume current research, gaps, hypotheses, or source facts.

3. **Transcript uploads do not upload transcript content.**
   - The file input retains only `File.name`.
   - Analysis submits a synthetic line naming the file.
   - TXT, VTT, SRT, and DOCX parsing must be implemented deliberately.

4. **Transcript synthesis is shallow.**
   - `lib/transcript.ts` uses fixed keyword lists and one regular expression for metrics.
   - It does not reconcile research, call notes, Canvas blocks, contradictions, tasks, roles, or decisions with model-assisted analysis.

5. **The canonical Canvas is not populated from research.**
   - The frontend reads `research.facts` directly.
   - `generateAuditReport()` reads `engagement.data.canvas`.
   - Research never writes that Canvas field, so the final report can claim every block is Missing.

6. **Generated deliverables are templates, not formal documents.**
   - No Google Doc, DOCX/PDF, or PandaDoc output exists.
   - The proposal and developer specification are generic around the detected constraint.

7. **External actions are intents only.**
   - Readiness email is not sent.
   - Google Sheets is not updated.
   - Google Docs and Drive artifacts are not created.
   - PandaDoc documents are not created.
   - Resend is not implemented.

8. **No application tenancy exists.**
   - There is a helper for reading Sites-authenticated headers, but `app/page.tsx` and API routes do not require it.
   - Database records contain no tenant, organization, or advisor-user owner ID.
   - The current outer Sites access setting is owner-only; it is not a substitute for app-layer authorization.

9. **The workflow stops before actual operations.**
   - Sprint activation, before/after measurement, constraint migration, and reusable catalog write-back are specification-only.

## Highest-priority implementation slice

Do this before adding Exa, Firecrawl, or new document providers.

### 1. Expand the research contract

Add source-grounded value-flow and interview-plan objects to `ResearchSynthesis`.

Suggested shape:

```ts
interface ValueFlowStep {
  id: string;
  order: number;
  name: string;
  description: string;
  input: string;
  output: string;
  actor: string;
  system: string;
  evidenceStatus: "public-research" | "advisor-note" | "gap";
  sourceUrls: string[];
  confidence: number;
  confirmationQuestion: string;
}

interface DiscoveryQuestion {
  id: string;
  section: "demand" | "promise" | "flow" | "constraint" | "baseline" | "roles" | "feasibility";
  question: string;
  whyItMatters: string;
  publicAssumption: string;
  sourceUrls: string[];
  evidenceStatus: "public-research" | "advisor-note" | "gap";
  hypothesisId?: string;
  expectedAnswerType: "narrative" | "number" | "person" | "choice";
  required: boolean;
  followUps: string[];
}
```

The model must return:

- a proposed flow only where sources support it;
- explicit gaps where public evidence cannot establish the real operating flow;
- questions tied to a fact, gap, Canvas block, flow step, or hypothesis;
- required diagnostic coverage without reusing generic text when client context exists.

### 2. Make one canonical Canvas

Map the retained research facts into `engagement.data.canvas` during `runResearch()`.

The UI and every document generator must read the same stored Canvas. Later client corrections should produce versioned revisions rather than a second unconnected representation.

### 3. Bind the UI to research

- Replace the fixed Flow of Work array with `research.valueFlow`.
- Replace `callTopics` with `research.discoveryQuestions` plus saved advisor edits.
- Keep a small mandatory diagnostic coverage contract, but generate the wording and public assumptions for the client.
- Let the advisor edit, reorder, add, disable, or mark a question answered before the call.
- Preserve large type, one primary action, and client-safe screen sharing.

### 4. Add regression tests

At minimum, use two contrasting company fixtures and prove:

- their Canvas facts differ;
- their proposed value-flow steps differ;
- their visible call questions differ;
- every public assumption has a retained source or is labeled Missing/Assumed;
- final deliverables use the same canonical Canvas visible in the research UI;
- deterministic fallback still produces safe gaps when OpenAI is unavailable.

## Second implementation slice

### Transcript ingestion and synthesis

1. Read actual TXT, VTT, and SRT data in the browser or a multipart server route.
2. Use a trusted DOCX text-extraction library server-side; reject unsupported or oversized files.
3. Preserve the raw immutable transcript.
4. Add structured OpenAI transcript synthesis for:
   - Canvas corrections;
   - actual value-flow steps and handoffs;
   - queues, waits, loops, approvals, and rework;
   - tasks and roles inside the traced flow;
   - client-attributed metrics;
   - contradictions and open gaps;
   - evidence for and against each hypothesis.
5. Keep deterministic guards after model analysis. The model may propose; it may not manufacture client evidence, consent, a confirmed baseline, or approval.
6. Reconcile Call 2 without overwriting Call 1 history.

## Third implementation slice

### Identity, tenancy, and production controls

- Require the authenticated user on every page and API route.
- Add `tenant_id`, `owner_user_id`, and optionally `advisor_user_id` to every engagement-owned table.
- Enforce ownership in every read and write query.
- Add an admin-safe advisor invitation/onboarding path.
- Define retention and deletion rules for transcripts and client data.
- Add request IDs, provider latency, token/search cost, error classification, and audit logs.
- Add rate limiting and abuse protection to research and transcript-analysis endpoints.
- Add idempotency to all external-action execution routes.

## Integration sequence

| Order | Integration | Why |
| --- | --- | --- |
| 1 | Fireflies | Closes the primary evidence-ingestion path |
| 2 | Google Sheets | Makes the lightweight CRM real |
| 3 | Google Drive/Docs | Creates collaborative approved artifacts |
| 4 | Gmail or Resend | Executes approved readiness and follow-up sends |
| 5 | PandaDoc | Produces formal proposal/SOW drafts and signatures |
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
