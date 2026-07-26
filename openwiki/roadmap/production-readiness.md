---
type: Roadmap
title: Production Readiness Roadmap
description: What the gap-closure change completed, the work that remains before the app is production-ready for multiple advisors and formal client documents, and the open product-owner decisions.
tags: [roadmap, production-readiness, integrations, tenancy]
---

# Production-readiness roadmap

## Completed by the gap-closure change

The three P0 tracks that dominated the previous roadmap are now implemented in source and covered by tests. They are listed here so nobody re-plans them.

| Track | Result |
| --- | --- |
| Research drives the workflow | `valueFlow` and `discoveryQuestions` are in `ResearchSynthesis`, produced deterministically and enriched by OpenAI; the Flow of Work tab and the Call 1 script read them; the hardcoded flow and `callTopics` are gone; the Integration Center renders `/api/integrations` |
| One canonical Canvas | `lib/canvas.ts` plus `engagement.data.canvas`, written by `runResearch()` and corrected by transcript evidence; `"Key Partnerships"` normalized; the Audit Report renders the Canvas the advisor reviewed |
| Transcript evidence | TXT, VTT, SRT, JSON, and DOCX decode into real speaker-attributed lines; raw text stays immutable; synthesis reconciles contradictions, Canvas updates, flow confirmations, decisions, tasks, roles, and metrics; Call 2 reconciles against Call 1 without silent overwrite |
| Identity and tenancy | `lib/auth.ts`, `owner_id` on every table, SQL-scoped queries, `REQUIRE_ADVISOR_AUTH`, `LEGACY_OWNER_EMAIL` backfill, `drizzle/0001_tenancy.sql` |
| Operational integrations | Resend, Google Sheets, and Google Drive/Docs adapters execute from approved intents |
| The operational loop | `SPRINT_ACTIVE`, `OUTCOME_MEASURED`, `CATALOG_WRITTEN` are implemented with an evidence-gated delta |

## P0 — Prove research adapts per company

Everything else is downstream of this claim being true.

- Build an automated test that runs research for two contrasting companies and asserts the resulting value flows and discovery questions differ.
- Add `researchQuality` — coverage and source-authority signals — so a weak result is detectable rather than merely unimpressive.
- Add an explicit `canvasRevision` so Canvas versions are addressable across approvals and documents.

**Exit:** a failing test, not a manual impression, catches a regression to a generic script.

## P0 — Tenancy hardening

Row scoping exists; the surrounding policy does not.

- Add an automated cross-owner isolation test.
- Add retention, deletion, and rate limiting.
- Decide whether an organization or team layer is needed above the individual advisor.
- Reconcile `integrationRuntimeStatus()` in `lib/integrations/index.ts` with the hand-built response in `app/api/integrations/route.ts`; one of the two should be the single source.

**Exit:** two unrelated advisors provably cannot read or mutate one another's records, and transcript retention has a stated period.

## P1 — Transcript synthesis depth

Synthesis is deterministic. That is honest and testable, and it is also the ceiling on diagnosis quality.

- Add model-assisted analysis **behind** the existing deterministic guards, never replacing them.
- Keep provenance rules intact: an advisor or unknown line may never become client evidence.
- Preserve the deterministic result alongside the model result so the two can be diffed.

**Exit:** a model pass improves recall on a fixed transcript corpus without weakening any evidence rule.

## P1 — Remaining integrations

1. Gmail, only if sending must come from the advisor's own mailbox rather than Resend.
2. PandaDoc proposal/SOW draft with a second explicit send and signature approval.
3. Exa as a threshold-triggered retrieval fallback, once `researchQuality` exists to trigger it.
4. Firecrawl for targeted known-site extraction failures.
5. Apollo, optional and credit-gated, only for a named unresolved gap.

Every adapter must be server-side, least-privilege, idempotent, observable, separately approval-gated, and must return `not-configured` rather than failing when its credential is absent.

## P1 — Research resilience

- Build a fixed evaluation corpus.
- Score source recall, unsupported-claim rate, Canvas coverage, value-flow usefulness, question specificity, latency, and cost.
- Add a fallback provider only where it improves a measured number.

## P2 — Formal documents

- Native DOCX or PDF rendering for the Diagnosis Package and Audit Report. Today the options are Markdown, printable HTML, and Google Docs conversion.
- A separate Roles and Responsibility Map artifact. Role entries are captured in `engagement.data.roles` but no artifact renders them.
- Proposal and SOW drafts from an approved PandaDoc template.

## Product-owner decisions

- Advisor identity provider and invitation model
- Whether tenancy needs an organization layer or stays per advisor
- Canonical CRM: D1 with Sheet export versus Google Sheet registry
- Google Workspace ownership and OAuth policy
- Email sender of record: Resend versus the advisor's Gmail
- PandaDoc template and commercial approval policy
- Transcript retention and deletion period
- Per-engagement research budget and fallback-provider threshold
- Transcript-analysis model and cost ceiling
- OpenWiki CI schedule, secret policy, and telemetry preference
