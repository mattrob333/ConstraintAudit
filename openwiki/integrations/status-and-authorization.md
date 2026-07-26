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

`lib/integrations/index.ts` exports `integrationRuntimeStatus()`, a compact per-provider status helper. `app/api/integrations/route.ts` builds the richer response the UI needs, but takes the `configured` flag for Resend, Google Sheets, and Google Drive/Docs from this helper, so the reported status cannot drift away from what an actual write would check.

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
| OpenAI research | `OPENAI_API_KEY`, `OPENAI_RESEARCH_MODEL` |
| Fireflies | `FIREFLIES_API_KEY` |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` |
| Google Sheets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SHEETS_ID` |
| Google Drive/Docs | the Google OAuth trio plus `GOOGLE_DRIVE_ROOT_FOLDER_ID` |
| Connector-first, unimplemented | `APOLLO_API_KEY`, `PANDADOC_API_KEY`, `PANDADOC_TEMPLATE_UUID` |

The application runs with none of these set. Research falls back to deterministic extraction and every approved intent reports `not-configured`.

## Research-provider routing

Keep OpenAI as the primary research path, with deterministic website research as the no-key and provider-failure fallback. A future quality gate may route to Exa when authoritative-source or Canvas coverage is weak. Firecrawl should receive a known URL or domain and extract only when standard retrieval is inadequate. Apollo remains opt-in and must show the expected credit consequence before use. None of these three exist in the source today.

## Remaining connector order

1. Gmail, only if the product needs sending from the advisor's own mailbox rather than Resend.
2. PandaDoc, for commercial acceptance and signature, with a second explicit approval before any send.
3. Exa and Firecrawl, once a research-quality signal exists to trigger them.
4. Apollo, only for a named unresolved gap and only with the credit cost shown before approval.

Every new adapter must be server-side, least-privilege, idempotent, observable, and separately approval-gated, and must return `not-configured` rather than failing when its credential is absent.
