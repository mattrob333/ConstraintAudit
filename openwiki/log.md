# Wiki update log

## 2026-07-27 — walkthrough rebuild and intake re-grounding

A second pass on the same day, against source at `b835bd6`. Two changes had landed since `5f50feb`: the practice walkthrough was rebuilt from 15 prose stops into 8 terse ones, and intake stopped requiring a contact email.

### Pages updated

`index.md`, `quickstart.md`, `workflows/practice-mode.md`, `workflows/throughput-audit-lifecycle.md`, `integrations/status-and-authorization.md`, `operations/local-development-and-deployment.md`, `testing/verification.md`, `roadmap/production-readiness.md`, `log.md`. Outside the wiki: `README.md`, `DEVELOPER_HANDOFF.md`, `NEXT_STEPS.md`, `public/docs/current-state.md`, `tests/rendered-html.test.mjs`.

### False claims corrected

- **"A 15-stop walkthrough."** `practiceTour` in `AdvisorCockpit.tsx` holds **8** stops — intake, research-canvas, call-kit, transcript, synthesis, diagnosis, deliver, report — each a `blurb` plus a `points` list. The old three-section prose format and the Prepare and Call stops are gone, as is the `CallBriefing` panel. Appeared in `roadmap/production-readiness.md`, `README.md`, `NEXT_STEPS.md`, and `public/docs/current-state.md`.
- **"The readiness-brief send is gated only by artifact approval."** Incomplete since intake stopped collecting a contact email. `readinessBriefAction()` now also refuses `send_intent` when `engagement.email` is blank, and the Prepare screen is where the address is captured. Stated on `workflows/throughput-audit-lifecycle.md` and `integrations/status-and-authorization.md`.
- **"43 tests (2 rendered-frontend, 40 backend across four `tsx` files)."** Re-derived by running each file: **3 + 16 + 11 + 7 + 7 + 6 = 50**. `tests/bug-review.test.mjs` had been in `package.json` since `4d3f753` and was documented nowhere, and both `rendered-html` and `backend-workflow` had grown by one. Corrected in `index.md`, `quickstart.md`, `operations/`, `testing/`, `README.md`, and `DEVELOPER_HANDOFF.md`.
- **"Two different practice-id tests; the client uses `id.startsWith("eng_demo_")`."** It does not. `PRACTICE_ID_PREFIX` in `AdvisorCockpit.tsx` is `"eng_demo_practice"`, identical to `DEMO_ENGAGEMENT_ID` in `lib/demo.ts`. `DEVELOPER_HANDOFF.md` gotcha 8 rewritten into the real hazard: the constant is duplicated with nothing enforcing agreement.
- **"Intake captures the primary contact's role"** stated without saying what intake now requires. Only the company name and the website are required; the contact block and the email are optional. Corrected on `workflows/throughput-audit-lifecycle.md` and `DEVELOPER_HANDOFF.md`.

### Source evidence

`app/components/AdvisorCockpit.tsx` (`practiceTour`, `PracticeTour`, `Intake`, `Prepare`, `Research`, `guidanceHidden`, `PRACTICE_ID_PREFIX`), `lib/actions.ts` (`readinessBriefAction`), `lib/demo.ts`, `package.json`, and every file in `tests/` run individually for its count.

### Gaps recorded as still open

- No test covers the new email send-gate or the Prepare-screen email capture. The gate is source-verified only.
- `tests/rendered-html.test.mjs` now pins the absence of `CallBriefing`/`ifYouGetLost`/`callArc`/`mustLeaveWith` in the cockpit, but nothing pins the walkthrough's stop count or ids.

## 2026-07-27 — full wiki re-grounding

Re-grounded the whole wiki against source at `5f50feb`. Seven commits had landed since the last pass (`c5ae88f` → `5f50feb`) and several pages had gone from accurate to confidently wrong. Every claim below was verified by reading the code, not by trusting the change list I was given.

### Pages updated

`index.md`, `quickstart.md`, `architecture/index.md`, `architecture/system-overview.md`, `domain/index.md`, `domain/research-and-evidence.md`, `workflows/index.md`, `workflows/throughput-audit-lifecycle.md`, `integrations/status-and-authorization.md`, `operations/local-development-and-deployment.md`, `testing/verification.md`, `roadmap/production-readiness.md`, `log.md`.

### Pages added

- `architecture/identity-and-access.md` — the principal precedence chain, the four `advisorAuthMode()` values, and exactly what `verifyAccessJwt()` checks.
- `domain/model-assisted-synthesis.md` — the grounding contract, the union merge, and the four-tier metric-direction inference.
- `workflows/practice-mode.md` — the deterministic fictional engagement and how it is kept out of client work.

### False claims corrected

- **"Transcript synthesis is deterministic; model-assisted synthesis is specified but not implemented."** It is shipped. `lib/openai-transcript.ts` runs a reasoning model over the numbered transcript and `groundModelSynthesis()` in `lib/openai-transcript-schema.ts` re-checks every citation against a real `client-stated` line. Appeared in `quickstart.md` (twice, including the "critical warning" section), `domain/research-and-evidence.md`, `workflows/throughput-audit-lifecycle.md`, `architecture/system-overview.md`, `testing/verification.md`, and `roadmap/production-readiness.md`.
- **"`interpretation` stays `not-interpreted` unless the advisor supplies `improvedWhen`."** True of `computeMetricDelta()`, and no longer true of the application. `measureOutcome()` calls `resolveMetricDirection()`, so an outcome can read `improved` with nobody having declared anything. This was the most dangerous stale claim on the wiki — it read as a guarantee and had become a description of one function. Rewritten on three pages into what is actually guaranteed: the app never guesses *silently*, records source/basis/confidence in `directionInference`, never pre-selects an ambiguous reading, and accepts a `PATCH` override.
- **"`generateDeliverables()` produces five Markdown artifacts"** and **"a separate Roles and Responsibility Map artifact is still not generated."** Six artifacts; `generateRolesMap()` exists and `roles_map` is in the definitions list. The roadmap's P2 line asking for it was also stale.
- **"26 backend tests and 2 rendered-frontend tests."** Re-derived from `package.json` and every file in `tests/`: 3 + 15 + 11 + 7 + 7 = **43**. Two test files (`reasoning`, `practice-mode`) did not exist when the number was last written. Corrected in `quickstart.md`, `operations/`, and `testing/`.
- **"Every API route calls `requirePrincipal`."** There are 25 route files and **all 25 call `requirePrincipalAsync`**. The synchronous `requirePrincipal` / `resolvePrincipal` have zero call sites under `app/api/`.
- **"OpenAI Sites supplies the current hosting environment, D1 binding, outer access control, and production environment variables."** Sites is now the legacy host. `wrangler.jsonc` and `docs/DEPLOYMENT.md` configure and document Cloudflare Workers with Cloudflare Access in front. The architecture and operations pages now describe both and say which is which.
- **"`lib/auth.ts` resolves a `Principal` from the `oai-authenticated-user-email` header."** That is now the *second* source in a three-step precedence chain, behind a signature-verified Access assertion.
- **"Cloudflare Workers is the lowest-friction non-Sites host"** / **"the simplest alternative."** It is the configured, documented target, not a hypothetical.
- **Roadmap P0 "Build an automated test that runs research for two contrasting companies."** Already done — `tests/gap-closure.test.mjs` has asserted it since the previous pass. The roadmap and the quickstart disagreed with each other about this; the quickstart was right.
- **Roadmap P0 "Reconcile `integrationRuntimeStatus()` with the hand-built response in `app/api/integrations/route.ts`."** Done in `c5ae88f`; the route reads `adapterReady()` from the helper. The previous log entry recorded the fix while the roadmap still asked for it.
- **Roadmap P1 "Add model-assisted analysis behind the existing deterministic guards, never replacing them."** Done, and done in exactly that shape — the deterministic result is the base of a union merge.
- **Testing page "model-assisted transcript synthesis, which does not exist."** It exists; the coverage gap moved rather than closing, and is now stated precisely (the grounding gate is tested, the HTTP path and `merge()` are not).
- **Operations page repository state.** Was pinned to `05d985d` / `925b839`; now `5f50feb`, with the seven intervening commits tabulated.
- **`quickstart.md` "Still absent: … model-assisted transcript synthesis"** — removed, and the absent list re-derived from source: no outreach funnel, no per-advisor Google OAuth, no Gmail/Apollo/PandaDoc adapter, no native DOCX or PDF, no Exa or Firecrawl.

### New capability documented

`POST /api/engagements/:id/sources` (doc-provenance ingest, explicit PDF refusal); `POST /api/engagements/:id/findings-agenda` and the client-facing presentation view; `GET /api/metric-direction`; `PATCH /api/engagements/:id/outcome`; `GET`/`POST /api/demo`; `primaryContactRole` and `drizzle/0002_contact_role.sql`; `FIXED_SPRINT_PRICE_USD = 2500`; the `AdvisorOnly` unmount pattern and the `Escape` panic key; `resumeScreens`; the `advisor_auth` entry on `/api/integrations`.

### Source evidence

`lib/access-jwt.ts`, `lib/auth.ts`, `lib/actions.ts`, `lib/openai-transcript.ts`, `lib/openai-transcript-schema.ts`, `lib/metric-direction.ts`, `lib/demo.ts`, `lib/workflow.ts`, `lib/store.ts`, `lib/deliverables.ts`, `lib/integrations/**`, `db/schema.ts`, `drizzle/**`, `app/api/**` (all 25 route files), `app/components/AdvisorCockpit.tsx`, `tests/**`, `package.json`, `wrangler.jsonc`, `docs/DEPLOYMENT.md`, `.env.example`.

### Gaps recorded as still open

- No outreach or prospecting funnel of any kind exists.
- Google actions use one shared service refresh token; there is no per-advisor OAuth, so a second advisor's approved intent would write as the first advisor's Google identity.
- Gmail, Apollo, PandaDoc, Exa, and Firecrawl remain unimplemented.
- No native DOCX or PDF export, and no PDF *ingest* either — `ingestSourceDocument()` refuses PDFs outright.
- `lib/access-jwt.ts` has **no automated test**, and no live Cloudflare Access sign-in is evidenced in this repository. The identity boundary is implemented-but-unproven, and every page that mentions it now says so.
- The Cloudflare Workers deploy is documented-but-unproven for the same reason.
- `synthesizeTranscriptWithOpenAI()`'s HTTP path, `merge()`, the constraint-disagreement gap, and `resolveMetricDirection()`'s tier 4 are all untested.
- DOCX decoding is asserted only at the format-detection level; the ZIP + `DecompressionStream` path is never exercised end to end.
- Cross-owner isolation is still a manual check, not an assertion.
- `canvasRevision` and `researchQuality` remain specified but not implemented — confirmed by grep, neither identifier appears anywhere in `lib/` or `app/`.
- Retention, deletion, and rate limiting are absent; `deleteEngagementCascade()` exists but only Practice mode calls it.
- No organization or team layer above the individual advisor.

### Source disagreements recorded

- **The change list I was given said "all 24 API routes moved to `requirePrincipalAsync`". There are 25 route files.** The claim about the migration being complete is correct — all of them do — but the count was wrong, so the wiki now states 25 and I checked each file rather than trusting the total.
- **`quickstart.md` and `roadmap/production-readiness.md` disagreed with each other** about whether the "two contrasting companies produce different flows" test existed. The test existed. The roadmap was stale, and it had been stale since the previous pass — the same document that recorded fixing this class of drift reintroduced it. Worth noting as a pattern: the roadmap's "completed" table gets updated and its "planned" sections do not.
- **The stepper and the CRM stage vocabulary genuinely differ in source**, and the wiki previously described only one. `AdvisorCockpit.tsx` names the last stage `"Operate"`; `CRM_STAGES` in `lib/workflow.ts` names it `"Sprint & Catalog"`, and that is what `stageForState()` returns and what the engagement record stores. Not a bug, but the lifecycle page now states both so a future reader does not "fix" one to match the other.
- **`app/api/integrations/route.ts` hardcodes a CRM spreadsheet URL and `.env.example` ships a real `GOOGLE_SHEETS_ID` default.** Non-secret identifiers, not credentials, and no secret value has been recorded anywhere in this wiki — but they are deployment-specific values sitting in committed source. Recorded on the integrations page and as a roadmap item rather than silently ignored.
- Root documentation (`README.md`, `DEVELOPER_HANDOFF.md`, `DEVELOPMENT_LOG.md`, `INTEGRATIONS.md`, `public/docs/**`) was being revised in parallel during this pass and was **not** read as truth. Every claim on these pages is grounded in source. If a root document now disagrees with a wiki page, re-check the source before assuming either is right.

## 2026-07-26

Rewrote the wiki against the gap-closure change (`05d985d`). Every claim below was verified against current source before writing.

### Pages updated

`index.md`, `quickstart.md`, `architecture/index.md`, `architecture/system-overview.md`, `domain/index.md`, `domain/research-and-evidence.md`, `workflows/index.md`, `workflows/throughput-audit-lifecycle.md`, `integrations/index.md`, `integrations/status-and-authorization.md`, `operations/local-development-and-deployment.md`, `testing/verification.md`, `roadmap/production-readiness.md`.

### False claims corrected

- **"The Value Flow and guided Call 1 script are fixed frontend scaffolds."** `ResearchSynthesis` now carries `valueFlow` and `discoveryQuestions`, built deterministically in `lib/research.ts` and enriched via `lib/openai-research.ts`. `AdvisorCockpit.tsx` no longer contains the six hardcoded flow strings or the `callTopics` demo script.
- **"There is no canonical Canvas; `runResearch()` never populates `engagement.data.canvas`."** `lib/canvas.ts` now owns the Canvas and `runResearch()` writes it. The Missing-blocks defect in `generateAuditReport()` is closed.
- **"Transcript uploads submit only the filename."** `lib/transcript-files.ts` decodes TXT, VTT, SRT, JSON, and DOCX into `[MM:SS] Speaker: text` lines.
- **"The schema has no tenant or owner ID and no row-level authorization boundary."** Every table carries `owner_id`, every query in `lib/store.ts` is scoped in SQL, and `lib/auth.ts` resolves the principal.
- **"External actions are intents only; Google Sheets, Google Docs, and Resend are not implemented."** All three adapters exist in `lib/integrations/` and execute from an approved intent.
- **"Sprint measurement and catalog write-back are not implemented."** `activateSprint`, `measureOutcome`, and `writeCatalogEntry` complete the state machine.
- **"The Integration Center hardcodes every card except OpenAI."** It now reads `/api/integrations`.
- **"Fifteen backend tests pass."** 26 backend tests and 2 rendered-frontend tests now pass.

### Source evidence

`lib/workflow.ts`, `lib/canvas.ts`, `lib/auth.ts`, `lib/research.ts`, `lib/openai-research-schema.ts`, `lib/transcript.ts`, `lib/transcript-files.ts`, `lib/actions.ts`, `lib/store.ts`, `lib/integrations/**`, `lib/deliverables.ts`, `app/api/**`, `app/components/AdvisorCockpit.tsx`, `db/schema.ts`, `drizzle/0001_tenancy.sql`, `tests/**`, `.env.example`.

### Gaps recorded as still open

- Apollo and PandaDoc remain connector-first with no direct adapter; Gmail has no adapter and Resend is the implemented sender.
- Deliverables are Markdown plus printable HTML; there is no native DOCX or PDF generator.
- Transcript synthesis is deterministic, not model-assisted.
- Exa and Firecrawl are not implemented.
- `canvasRevision` and `researchQuality` are still specified but not implemented.
- Retention, deletion, rate limiting, and any organization layer above the individual advisor are absent.

### Source disagreements recorded

- `DEVELOPER_HANDOFF.md`, `README.md`, `DEVELOPMENT_LOG.md`, and `public/docs/current-state.md` were refreshed on 2026-07-26 and now agree with the source.
- Three disagreements found while grounding this pass were fixed in code rather than documented around: `GET /api/integrations` now calls `requirePrincipal`; `app/api/integrations/route.ts` now takes its `configured` flags from `integrationRuntimeStatus()` so the reported status cannot drift from what a write checks; and the outcome route now declares `improvedWhen` in its request type.

## 2026-07-25

- Created the initial repository wiki in Open Knowledge Format v0.1.
- Grounded pages in the current source, automated tests, canonical workflow, integration contract, and developer handoff.
- Explicitly separated shipped behavior from target behavior.
- Recorded the static Value Flow, static Call 1 topics, filename-only upload defect, canonical-Canvas mismatch, intent-only integrations, and missing tenancy as current gaps.
- Added the production-readiness sequence and verification requirements.

Open questions remain in `DEVELOPER_HANDOFF.md` and the roadmap page.
