# Wiki update log

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
