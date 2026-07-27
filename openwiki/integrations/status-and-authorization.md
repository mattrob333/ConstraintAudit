---
type: Integration Reference
title: Integration Status and Authorization
description: Current execution status, required server-side credentials, the intent approval boundary, not-configured semantics, and recommended connector order for research, transcripts, documents, email, and CRM.
tags: [integrations, authorization, openai, fireflies, google, resend, pandadoc]
---

# Integration status and authorization

The canonical contract is `INTEGRATIONS.md`. The truthful runtime status endpoint is `GET /api/integrations`, which the Integration Center now renders directly — no card is asserted by the browser.

## Current status

| Integration | Server implementation | Current execution |
| --- | --- | --- |
| Cloudflare D1 | Implemented | Connected, owner-scoped persistence |
| Deterministic public research | Implemented | Ready without credentials |
| OpenAI web research | Implemented | Runs with `OPENAI_API_KEY` |
| Fireflies | Implemented | Server-side import; requires `FIREFLIES_API_KEY` |
| Resend | **Implemented** | Sends an approved `readiness_brief_send` intent; requires `RESEND_API_KEY` and `EMAIL_FROM` |
| Google Sheets | **Implemented** | Appends or updates the CRM row from an approved `crm_write_back` intent; requires Google OAuth plus `GOOGLE_SHEETS_ID` |
| Google Drive/Docs | **Implemented** | Creates a Google Doc from an approved `document_publish` intent; requires Google OAuth |
| Gmail | Not implemented | No adapter. Resend is the implemented sender |
| Apollo | Not implemented | Connector-first, credit-gated plan |
| PandaDoc | Not implemented | Connector-first; proposal/SOW draft plus a separate send approval remains a plan |
| Exa | Not implemented | Proposed research fallback |
| Firecrawl | Not implemented | Proposed targeted extraction fallback |
| Native DOCX / PDF | Not implemented | Printable HTML plus Google Docs conversion is the current route to a formal document |
| Outreach / prospecting | Not implemented | No funnel, no sequencing, no adapter, nothing in the source |
| Per-advisor Google OAuth | Not implemented | See below |

Two additions since the last pass:

- **OpenAI is now used for transcript synthesis as well as research**, via `OPENAI_TRANSCRIPT_MODEL` (falling back to `OPENAI_RESEARCH_MODEL`) on the same `OPENAI_API_KEY`, and for the tier-4 metric-direction question. It remains a research/reasoning provider only; it performs no external write.
- **`GET /api/integrations` now reports the advisor identity source** as an `advisor_auth` entry, carrying `advisorAuthMode()` in its `mode` field and mapping it to a status: `cloudflare-access` and `sites-headers` both report `enforced`, `denied` reports `misconfigured`, and `local-fallback` reports `single_advisor` with the warning that everyone is treated as one local advisor. See [Identity and access](../architecture/identity-and-access.md).

`lib/integrations/index.ts` exports `integrationRuntimeStatus()`, a compact per-provider status helper. `app/api/integrations/route.ts` builds the richer response the UI needs, but takes the `configured` flag for Resend, Google Sheets, and Google Drive/Docs from this helper, so the reported status cannot drift away from what an actual write would check. Apollo and PandaDoc, which have no adapter, are checked by a local env probe instead and report `configured_not_implemented` when a key is present — an honest label for "the credential exists and nothing can use it".

### Google identity is the deployment's, not the advisor's

Every Google write — the Sheets CRM row and the Drive/Docs publication — authenticates with **one** service refresh token (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN`) held in the deployment's environment. There is no per-advisor OAuth flow anywhere in the source.

The consequences are worth stating plainly, because row-level tenancy does not extend to them: every advisor's approved intent writes as the same Google principal, into the same spreadsheet (`GOOGLE_SHEETS_ID`) and the same Drive; a created Doc is owned by that account, not the advisor; and revoking one advisor's access does not revoke anything on the Google side. This is acceptable for a single-advisor deployment and is not acceptable for a multi-advisor one.

## The approval boundary

Credentials stay server-side. The browser never receives API keys or refresh tokens. **A configured connector is not permission to act.**

Every externally-visible action is an intent, and `lib/actions.ts` is the only place an adapter is invoked:

1. an intent is created in `pending_review` (readiness-brief send, CRM write-back, document publish);
2. `reviewIntent()` accepts `approve`, `reject`, or `execute`;
3. `execute` throws unless the intent is already `approved`, so approval and execution stay two separate decisions;
4. the adapter is called with the intent id as its idempotency key;
5. the result is written back to the intent and recorded as an activity with provider, status, detail, and any external URL.

A send intent additionally requires a reviewed, immutable, approved input artifact — `requireApprovedReadinessArtifact()` rejects a regenerated or mismatched brief.

### not-configured is not a failure

An unconfigured provider returns `status: "not-configured"`, performs **no network call**, and leaves the intent `approved`, so the same approval can be executed once credentials exist. A genuine failure moves the intent to `failed` and requires a fresh approval, because the app cannot know whether the write landed.

### Idempotency and refusal to guess

- Resend receives the intent id as an `Idempotency-Key` header and the adapter performs no retry of its own.
- Google Sheets reads the header row, locates the row by `matchKey`, and updates it in place. It refuses to write at all when the match column has no value, rather than blind-appending a duplicate row.
- Google Docs creation goes through Drive with the narrow `drive.file` scope, converting rendered HTML so headings, lists, and tables survive.

## Required environment variables

| Purpose | Variables |
| --- | --- |
| Advisor identity and tenancy | `REQUIRE_ADVISOR_AUTH`, `LOCAL_ADVISOR_EMAIL`, `LEGACY_OWNER_EMAIL` |
| Cloudflare Access identity | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` — set both or neither |
| OpenAI research | `OPENAI_API_KEY`, `OPENAI_RESEARCH_MODEL` (default `gpt-5.6-sol`) |
| OpenAI transcript synthesis | `OPENAI_TRANSCRIPT_MODEL` — optional; falls back to `OPENAI_RESEARCH_MODEL` |
| Fireflies | `FIREFLIES_API_KEY` |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` |
| Google Sheets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SHEETS_ID` |
| Google Drive/Docs | the Google OAuth trio plus `GOOGLE_DRIVE_ROOT_FOLDER_ID` |
| Connector-first, unimplemented | `APOLLO_API_KEY`, `PANDADOC_API_KEY`, `PANDADOC_TEMPLATE_UUID` |

The application runs with none of these set. Research and transcript synthesis fall back to their deterministic paths, metric direction falls back to its three deterministic tiers, and every approved intent reports `not-configured`.

`.env.example` also carries a real `GOOGLE_SHEETS_ID` default pointing at a specific spreadsheet, and `app/api/integrations/route.ts` hardcodes the matching CRM URL. That is a non-secret identifier, not a credential, but it is a deployment-specific value sitting in committed source and should be replaced before anyone else deploys this.

## Research-provider routing

Keep OpenAI as the primary research path, with deterministic website research as the no-key and provider-failure fallback. A future quality gate may route to Exa when authoritative-source or Canvas coverage is weak. Firecrawl should receive a known URL or domain and extract only when standard retrieval is inadequate. Apollo remains opt-in and must show the expected credit consequence before use. None of these three exist in the source today.

## Remaining connector order

1. **Per-advisor Google OAuth**, before any second advisor gets a Google-backed action. Everything below that touches Google is compromised by a shared service token, so this comes first.
2. **Gmail**, which is downstream of the same OAuth work — sending from the advisor's own mailbox is only meaningful once the advisor has their own Google grant.
3. **PandaDoc**, for commercial acceptance and signature, with a second explicit approval before any send.
4. **Exa and Firecrawl**, once a research-quality signal exists to trigger them.
5. **Apollo**, only for a named unresolved gap and only with the credit cost shown before approval.

An outreach or prospecting funnel would sit ahead of all of these in product order and behind them in engineering order: it needs a sender identity and an enrichment source before it can exist at all.

Every new adapter must be server-side, least-privilege, idempotent, observable, and separately approval-gated, and must return `not-configured` rather than failing when its credential is absent.
