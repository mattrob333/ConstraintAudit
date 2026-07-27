---
type: Roadmap
title: Production Readiness Roadmap
description: What is now complete in source, what genuinely remains before the app is production-ready for multiple advisors and formal client documents, and the open product-owner decisions.
tags: [roadmap, production-readiness, integrations, tenancy, oauth]
---

# Production-readiness roadmap

## Completed and verified in source

Listed so nobody re-plans them. Every row was confirmed against current source on 2026-07-27.

| Track | Result |
| --- | --- |
| Research drives the workflow | `valueFlow` and `discoveryQuestions` in `ResearchSynthesis`, produced deterministically and enriched by OpenAI; the Flow of Work tab and the Call 1 script read them; the Integration Center renders `/api/integrations` |
| One canonical Canvas | `lib/canvas.ts` plus `engagement.data.canvas`, written by `runResearch()` and corrected by transcript evidence; `"Key Partnerships"` normalized |
| Transcript evidence | TXT, VTT, SRT, JSON, and DOCX decode into real speaker-attributed lines; raw text stays immutable; Call 2 reconciles against Call 1 without silent overwrite |
| Identity and tenancy | `owner_id` on every table, SQL-scoped queries, `REQUIRE_ADVISOR_AUTH`, `LEGACY_OWNER_EMAIL` backfill |
| Operational integrations | Resend, Google Sheets, and Google Drive/Docs adapters execute from approved intents |
| The operational loop | `SPRINT_ACTIVE`, `OUTCOME_MEASURED`, `CATALOG_WRITTEN` with an evidence-gated delta |
| **Research adapts per company, proven by test** | `tests/gap-closure.test.mjs` asserts a fabricator and a dental clinic produce non-identical flows and question sets. The old P0 is closed |
| **Model-assisted transcript synthesis behind the deterministic guards** | `lib/openai-transcript.ts` + `groundModelSynthesis()`. The deterministic result is preserved and merged as a union, never replaced; every model citation is re-grounded to a `client-stated` line; rejections are surfaced rather than dropped silently |
| **Metric direction inference** | `lib/metric-direction.ts` four tiers, `GET /api/metric-direction` preview, `PATCH /api/engagements/:id/outcome` correction, `DirectionInference` recorded on the outcome |
| **Cloudflare Access as identity provider** | `lib/access-jwt.ts` real RS256 verification; `advisorAuthMode()`; all 25 API route files on `requirePrincipalAsync` |
| **Cloudflare Workers deployment path** | `wrangler.jsonc` + `docs/DEPLOYMENT.md`, replacing OpenAI Sites |
| **Source-document ingest** | `POST /api/engagements/:id/sources` at `doc` provenance; PDF refused explicitly |
| **The Roles & Responsibility Map artifact** | `generateRolesMap()`; `generateDeliverables()` now produces six artifacts, not five |
| **Findings Call agenda and presentation view** | `POST /api/engagements/:id/findings-agenda` + a client-facing view with no advisor-only content |
| **Practice mode** | `lib/demo.ts` + `POST /api/demo` + an 8-stop walkthrough; deterministic, offline, free |
| **Advisor-only live-call coaching** | `AdvisorOnly` unmounts rather than hiding; `Escape` is a one-way panic key |
| **Resume routing** | Keyed on `workflowState` through `resumeScreens`, falling back to `research` |
| **`primaryContactRole`** | Column, migration, and reuse as the default named owner at diagnosis approval |
| **Integration status single-sourced** | `app/api/integrations/route.ts` takes its `configured` flags from `integrationRuntimeStatus()`. The old P0 reconciliation item is closed |

## P0 — Prove the identity boundary

The most consequential code added since the last pass is also the least verified. Everything below assumes an advisor is who the app says they are.

- Add automated tests for `lib/access-jwt.ts`: a valid assertion, a wrong audience, a wrong issuer, an expired token, a tampered signature, an unknown `kid`, and a token with no `email` claim.
- Add a test for the `denied` mode — exactly one `CF_ACCESS_*` binding set while `REQUIRE_ADVISOR_AUTH` is on must authenticate nobody.
- Add an automated cross-owner isolation test, so the "indistinguishable from a missing record" property is asserted rather than manually observed.
- Execute the `docs/DEPLOYMENT.md` walkthrough against a real Cloudflare account and record the evidence, including turning `workers_dev` off.

**Exit:** a failing test catches a regression in identity verification, and a real Access sign-in is recorded in `DEVELOPMENT_LOG.md`.

## P0 — Per-advisor Google OAuth

Row-level tenancy stops at the application boundary. Every Google write uses one shared service refresh token, so a second advisor's approved intent writes as the first advisor's Google identity, into the same spreadsheet and the same Drive, and revoking an advisor revokes nothing on the Google side.

- Add a per-advisor OAuth grant and store the refresh token scoped to the owner.
- Make `googleConfigured()` and the Sheets/Docs adapters resolve credentials per principal rather than per deployment.
- Decide what happens to an approved intent whose owner has revoked their grant — `not-configured` is the honest answer, and it must not become a silent failure.

**Exit:** two advisors' Google actions are attributable to two different Google accounts, and neither can write through the other's grant.

This blocks Gmail, blocks any outreach funnel, and blocks widening the deployment to a second advisor. Nothing else on this roadmap is as load-bearing.

## P0 — Tenancy hardening

Row scoping exists; the surrounding policy does not.

- Add retention, deletion, and rate limiting. Transcripts currently persist indefinitely.
- Expose engagement deletion to the advisor. `deleteEngagementCascade()` exists but only Practice mode calls it.
- Decide whether an organization or team layer is needed above the individual advisor.
- Replace the committed `GOOGLE_SHEETS_ID` default in `.env.example` and the hardcoded CRM URL in `app/api/integrations/route.ts` with configuration.

**Exit:** transcript retention has a stated period, an advisor can delete their own data, and no deployment-specific identifier ships in source.

## P1 — Close the reasoning test gaps

The reasoning code is well designed and unevenly tested. `groundModelSynthesis()` and metric-direction tiers 1–3 are covered; the paths around them are not.

- Test `synthesizeTranscriptWithOpenAI()` with a stubbed fetcher: success, HTTP error, timeout, empty output, unparseable JSON. All must fall back to the deterministic reading with the right `modelStatus`.
- Test `merge()`: the union behavior, the role-disagreement collapse to `mixed`, the rule that `unconfirmed` never overwrites a grounded flow reading, and that the model cannot grant `client-verified`.
- Test the constraint-disagreement path — the model's reading wins, the deterministic evidence is not carried across, and a plain-language gap is written.
- Test `resolveMetricDirection()` tier 4 with a stubbed fetcher, including degradation to tiers 2–3 on failure and on `"unclear"`.
- Test `correctOutcomeDirection()`: the numbers do not move, the delta is recomputed, the source becomes `advisor`.

**Exit:** the model paths fail loudly in CI rather than silently in production.

## P1 — Research quality signals

- Add `researchQuality` — coverage and source-authority signals — so a weak result is detectable rather than merely unimpressive. Still specified, still not implemented.
- Add an explicit `canvasRevision` so Canvas versions are addressable across approvals and documents. Still specified, still not implemented.
- Build a fixed evaluation corpus and score source recall, unsupported-claim rate, Canvas coverage, value-flow usefulness, question specificity, latency, and cost.

**Exit:** a fallback provider can be triggered by a measured number rather than a hunch.

## P1 — Remaining integrations

In dependency order rather than wish order:

1. **Gmail**, once per-advisor OAuth exists. Sending from the advisor's own mailbox is meaningless without it.
2. **PandaDoc** proposal/SOW draft with a second explicit send and signature approval.
3. **Exa** as a threshold-triggered retrieval fallback, once `researchQuality` exists to trigger it.
4. **Firecrawl** for targeted known-site extraction failures.
5. **Apollo**, optional and credit-gated, only for a named unresolved gap and only with the credit cost shown before approval.

Every adapter must be server-side, least-privilege, idempotent, observable, separately approval-gated, and must return `not-configured` rather than failing when its credential is absent.

## P2 — Outreach and prospecting funnel

**Nothing of this exists.** The product currently begins at an engagement the advisor created by hand at intake; there is no discovery, qualification, sequencing, or contact anywhere in the source.

It is sequenced last deliberately: a funnel needs a sender identity (per-advisor OAuth, then Gmail) and an enrichment source (Apollo) before it can be built at all, and both are upstream of it. Attempting it before those land produces a funnel that can only draft, never send, and can only guess at a prospect's details.

Before any of it is designed, the product owner needs to answer: what a prospect record is and whether it lives beside an engagement or apart from it; what consent and suppression rules govern outbound contact; and what the funnel is allowed to assert about a company it has only researched publicly — the same evidence discipline the audit enforces has to hold here, or the funnel becomes the place fabricated claims enter the product.

## P2 — Formal documents

- Native DOCX or PDF rendering for the Diagnosis Package and Audit Report. Today the options are Markdown, printable HTML, and Google Docs conversion.
- **PDF ingest**, the other half of the same gap: `ingestSourceDocument()` currently refuses PDFs outright. That refusal is the right behavior *until* extraction exists, and it is a real limitation on the advisor's most common source format.
- Proposal and SOW drafts from an approved PandaDoc template.

## Product-owner decisions

- Whether tenancy needs an organization layer or stays per advisor
- Google Workspace ownership and OAuth policy, and who owns a Doc created by an approved intent
- Canonical CRM: D1 with Sheet export versus Google Sheet registry
- Email sender of record: Resend versus the advisor's Gmail
- PandaDoc template and commercial approval policy
- Transcript retention and deletion period
- Per-engagement research budget, transcript-analysis model, and cost ceiling — the transcript pass requests up to 16,000 output tokens at medium reasoning effort per call, which is the largest per-engagement cost in the app
- Whether an inferred metric direction may reach a client document without an advisor confirming it, or whether the outcome report should block on an explicit declaration
- Whether an outreach funnel is in scope at all, and under what consent rules
- OpenWiki CI schedule, secret policy, and telemetry preference
