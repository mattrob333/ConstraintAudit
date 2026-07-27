# Tier 4 Advisor Cockpit Developer Handoff

**Handoff date:** 2026-07-27
**Audience:** the next AI agent or developer continuing implementation
**Branch at handoff:** `claude/repo-overview-b7tlrs`
**Documentation handoff source:** current Git `HEAD` and the working tree

## Mission

Finish the Tier 4 Advisor Cockpit as a research-adaptive, evidence-grounded client discovery and throughput-audit product.

The interface guides an advisor and client through:

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
2. Open **Practice mode** in the running app. It is a complete worked engagement and is faster than reading about the workflow.
3. `public/docs/workflow.md` — canonical target workflow and governance rules.
4. `openwiki/quickstart.md` — source map and reading order. Treat wiki claims as hints; verify against source.
5. `lib/workflow.ts` — domain types and workflow states.
6. `lib/actions.ts` — server-side business actions and approval gates.
7. `app/components/AdvisorCockpit.tsx` — the entire client UI, including the coaching layer and the practice walkthrough.
8. `docs/DEPLOYMENT.md` — Cloudflare Workers and Access.
9. `DEVELOPMENT_LOG.md` — dated decisions and verification history.

## Current implementation truth

### Working and verified in source

- Fresh engagement, external migration, and resume. Intake captures the primary contact's role as a real column, and can ingest a source document (TXT/VTT/SRT/JSON/DOCX; PDF is refused).
- Engagements, artifacts, transcripts, activities, and intents persist in Cloudflare D1. All five tables carry `owner_id`, every query is scoped in SQL, and post-release columns are added by an idempotent boot-time migration.
- All 25 API routes resolve the advisor through `requirePrincipalAsync`.
- Cloudflare Access is a real identity provider: `lib/access-jwt.ts` verifies the assertion signature against the team's published keys and checks issuer, audience and expiry. When Access is configured it is the *only* accepted source — no fallback to a spoofable header or the shared local advisor. `advisorAuthMode()` reports `cloudflare-access | sites-headers | local-fallback | denied`, and a half-configured Access rollout is `denied` rather than silently downgraded.
- Website input accepts bare domains; public URLs receive SSRF, redirect, DNS, and response-size checks.
- OpenAI Responses API web search runs server-side when configured, with `store: false`, a strict schema, and retained source URLs.
- Research produces a company-specific `valueFlow` and `discoveryQuestions`, deterministically with no API key and enriched when the key is present.
- One canonical Business Model Canvas (`lib/canvas.ts`) is written by research and corrected by client evidence. The audit report reads that Canvas. A corrected research claim is superseded, never deleted.
- Transcript upload decodes TXT, VTT, SRT, JSON, and DOCX into real speaker- and timestamp-attributed lines. The `.docx` reader is a hand-written ZIP central-directory parser plus `DecompressionStream`, Web APIs only, with a 2 MB ceiling and an explicit ZIP64 refusal.
- **Transcript synthesis is model-assisted.** `lib/openai-transcript.ts` sends the transcript with full business context and a strict JSON schema; `groundModelSynthesis` in `lib/openai-transcript-schema.ts` then verifies every quote, metric, Canvas correction and flow confirmation against a real transcript line whose provenance is `client-stated`. Anything unmatched is dropped into `groundingRejections`. The two readings are merged as a union; the constraint candidate is the single-winner decision and any disagreement is written into `gaps`. With no key or on any failure the deterministic reading stands, `analysisMode`/`modelStatus` record which, and the UI says so.
- **Metric direction is inferred, in four tiers** (`lib/metric-direction.ts`): the advisor's declaration, the unit, the metric name, then a narrow model question, with the basis recorded. Tiers 1-3 are pure, synchronous and total. Ambiguity yields `improvedWhen: null` with `ambiguous: true` so the UI asks instead of guessing. `correctOutcomeDirection` lets the advisor re-read a recorded outcome without mutating the measured numbers.
- Resend, Google Sheets, and Google Docs adapters perform real writes, reachable only from an explicitly approved intent, with the intent id as the idempotency key.
- Sprint activation, outcome measurement, and catalog write-back complete the workflow. `generateDeliverables` produces six artifacts at the diagnosis checkpoint (diagnosis package, audit report, proposal, roadmap, developer specification, roles map); a full engagement accumulates fourteen artifact kinds in total. The proposal carries a fixed `FIXED_SPRINT_PRICE_USD` of $2,500 with no ROI or payback number beside it.
- Both calls contain the required recording/transcription disclosure, and consent gates transcript processing.
- Missing baselines keep the finding provisional and block numeric projections. Diagnosis approval requires client evidence and a named human owner.
- **Live-call coaching** is an advisor-only layer on the guided-call screen (`AdvisorOnly`, `CoachRail`). Hidden content is removed from the DOM rather than CSS-hidden, so a screenshot, a scroll, and a screen reader all see the same thing. Escape hides it. The Findings Call screen has no advisor half at all.
- **Practice mode** (`lib/demo.ts`, `/api/demo`) seeds a complete fictional engagement — research through catalog entry, 14 documents, two transcripts — with no credential of any kind. It is deterministic (no `Date.now()`, no random ids), per-advisor (`eng_demo_practice_<ownerId>`), owner-scoped, listed separately from clients, labelled by an undismissable sticky bar plus a footer on every document, and resettable or removable.

### Verification status

`npm run lint`, `npx tsc --noEmit`, and `npm test` are the required checks; `npm test` builds first, then runs 43 checks (3 rendered-frontend, 40 backend). Counts and coverage per file are in `README.md`. No test needs the network or a key.

This handoff was written from source reading. It does not assert a fresh full-suite run or a browser pass on 2026-07-27 — run them yourself before shipping, per `AGENTS.md`.

### Deliberately constrained, not missing

These behave this way on purpose. Do not "fix" them without reading the reasoning.

- **A delta is refused rather than estimated.** Two client-confirmed readings in the same unit and period, or an explicit blocked reason. See `computeMetricDelta` in `lib/workflow.ts`.
- **Direction inference never overrides a human.** The advisor's `improvedWhen` is tier 1 and always wins; where the metric genuinely cannot settle it, no interpretation is produced.
- **A model can reason but cannot testify.** Model narrative and interpretation are `advisor-note`. Only text matched against a `client-stated` line becomes a quote, metric, or Canvas claim.
- **Approval and execution are two decisions.** An intent is created `pending_review`, must be approved, and only then may be executed. An unconfigured provider performs no network call and leaves the intent approved so it can be retried; a genuine failure stays failed and needs a fresh approval, because we cannot know whether the write landed.
- **Research can never emit `client-stated` or `doc` provenance.** A value-flow step whose source URL cannot be verified stays a proposal and is downgraded to `gap`.
- **The practice bar is not hidden on client-facing screens.** The greater risk is the advisor forgetting they are in practice mode. The consequence is that practice mode is unsuitable for rehearsing *with* a live audience.

## Still open

1. **No in-call value-flow editor.** This is the oldest unclosed item. `flowConfirmations` are produced by both the deterministic and the model pass and reach the generated documents (`lib/deliverables.ts`), but the cockpit never renders them: the Flow of Work screen reads `research.valueFlow` read-only, and there is no affordance to correct a step live and record the correction as `client-stated`.

2. **No native DOCX or PDF generator.** Deliverables are Markdown plus a self-contained printable HTML rendering (`renderMarkdownToHtml`, no external assets). Print-to-PDF and Google Docs conversion are the current routes to a formal document. A real DOCX writer needs a dependency that works on the Workers runtime — note that `lib/transcript-files.ts` already proves ZIP reading is feasible there with Web APIs alone, and ZIP *writing* would be the mirror problem.

3. **Gmail has no adapter.** Resend is the implemented sender; the Gmail entry in `/api/integrations` is `intent_only`. Apollo and PandaDoc are connector-first contracts with no adapter in this repository; setting their keys reports `configured_not_implemented`, which is deliberate.

4. **Exa and Firecrawl are not implemented.** The recommended routing in the README and `public/docs/architecture.md` remains a proposal.

5. **No outreach or prospecting funnel.** The product starts at an engagement that already exists. Nothing finds, qualifies, or contacts a prospect.

6. **Google is single-advisor.** `GOOGLE_REFRESH_TOKEN` is one environment variable, so approved Google writes act as one identity regardless of which advisor approved them. Multi-advisor Google access needs per-user encrypted token storage and revocation before the app is opened to a second advisor who expects their own Drive.

7. **Screen-share safety is advisor-asserted.** `presenting` is state the advisor sets; the app cannot detect a screen share. Specific rough edges worth knowing before changing that code:
   - Escape is one-way (it only ever sets `presenting = true`); restoring the rail requires the header toggle.
   - The Escape handler is on `document` with no target check, so it fires from inside the notes textarea too. That is arguably correct for a panic key, but it is not obvious.
   - `presenting` is not reset by `go()` — only by `resume()` and `leavePractice()` — so it persists across screens within one engagement.
   - The Documents menu and the send-intent modal register their own `document` Escape listeners without `stopPropagation`. They are not reachable from the call screen today, so this is latent rather than a live bug.

8. **Two different practice-id tests.** The client uses `id.startsWith("eng_demo_")`; the server's `isDemoEngagement` requires `eng_demo_practice`. Nothing generates a colliding id today, so this is a latent inconsistency, not a defect — but do not assume the two agree.

9. **`docs/DEPLOYMENT.md` Step 6a is stale.** It instructs the reader to migrate API routes from the synchronous resolver to `requirePrincipalAsync` "first". That migration is already done — every route under `app/api/` uses the async resolver. The synchronous `resolvePrincipal`/`requirePrincipal` remain exported in `lib/auth.ts` but have no caller. That file is owned elsewhere; correct it there rather than duplicating a fix.

10. **Fonts are fetched remotely.** `app/globals.css` opens with a Google Fonts `@import`, so type falls back where outbound access is blocked and the page makes a third-party request. Self-hosting the three families would remove both problems.

11. **Fireflies is unverified against a live account.** The adapter exists and needs `FIREFLIES_API_KEY`; no run against a real Fireflies workspace is recorded.

## Highest-priority next slice

1. Give the advisor an in-call editor for value-flow steps, writing corrections back with `client-stated` provenance, and surface `flowConfirmations` in the cockpit rather than only in generated documents.
2. Complete a real Cloudflare Workers deployment behind Access, following `docs/DEPLOYMENT.md`, and record the outcome (including anything the guide got wrong) in `DEVELOPMENT_LOG.md`.
3. Decide the DOCX path: a Workers-compatible writer, or an explicit product decision that Google Docs plus print-to-PDF is the formal-document route and the roadmap should stop implying otherwise.

## Integration sequence

| Order | Integration | Why |
| --- | --- | --- |
| 1 | Fireflies | Adapter exists; needs a key and one live verification. Direct file upload already covers this path |
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
  -> Google Docs renderer for collaborative artifacts        (implemented)
  -> printable HTML for a self-contained, print-to-PDF copy  (implemented)
  -> DOCX/PDF renderer for polished reports                  (not implemented)
  -> PandaDoc renderer for proposal/SOW and signature        (not implemented)
  -> Google Sheets renderer for CRM and catalog records      (implemented)
```

Recommended artifact destinations:

- Readiness Brief: Google Doc and reviewed email send.
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
6. complete a cold engagement from intake through the affected checkpoint — practice mode is a fast way to reach a late stage, but a real cold engagement is what proves intake;
7. test one failure path;
8. confirm no external send/write occurred without its explicit approval;
9. record the result in `DEVELOPMENT_LOG.md`;
10. update the wiki pages affected by the change.

## Known environment and deployment facts

- Node requirement: 22.13 or newer.
- Framework: Next-compatible app built with vinext/Vite; `@cloudflare/vite-plugin` produces the Worker bundle.
- Persistence: Cloudflare D1 through the `DB` binding.
- Cloudflare configuration lives in `wrangler.jsonc`; the deployment guide is `docs/DEPLOYMENT.md`.
- `.openai/hosting.json` is the legacy OpenAI Sites project descriptor, retained for the old deployment only.
- Production secret values are not in the repository. `.env.local` is ignored; `.env.example` lists every variable the app reads.
- `.wrangler/` holds local dev state only; nothing in the repository records a completed Cloudflare deployment.

## Decisions that still need the product owner

- Which Cloudflare account, domain, and Access policy own the production deployment?
- Should the first real CRM execution path use the existing Google Sheet or D1 as the canonical registry with Sheet export?
- Which Google account owns the Drive root and production OAuth client — and does each advisor eventually need their own?
- Which PandaDoc template is the approved commercial template?
- What transcript retention period and deletion workflow apply?
- What per-engagement OpenAI research and transcript-synthesis budget is acceptable?
- What confidence/source threshold should trigger an Exa fallback?
- Is the $2,500 fixed sprint fee current, and who approves a change to `FIXED_SPRINT_PRICE_USD`?

Do not guess these answers in code if they create external access, spending, retention, or contractual consequences.

## Handoff completion definition

The next major milestone is complete when the advisor can correct a value-flow step during a live call and see that correction carried as client-stated evidence into the canonical Canvas and the final report, and when the app is running on Cloudflare Workers behind verified Access with a real engagement in it.
