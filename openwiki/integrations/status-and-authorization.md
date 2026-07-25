---
type: Integration Reference
title: Integration Status and Authorization
description: Current execution status, required server-side credentials, approval boundaries, and recommended connector order for research, transcripts, documents, email, and CRM.
tags: [integrations, authorization, openai, fireflies, google, pandadoc]
---

# Integration status and authorization

The canonical contract is `INTEGRATIONS.md`. The truthful runtime status endpoint is `/api/integrations`.

## Current status

| Integration | Server implementation | Current execution |
| --- | --- | --- |
| Cloudflare D1 | Implemented | Connected persistence |
| Deterministic public research | Implemented | Ready without credentials |
| OpenAI web research | Implemented | Runs with `OPENAI_API_KEY` |
| Fireflies | Implemented | Requires `FIREFLIES_API_KEY` |
| Apollo | Not implemented | Connector-first/credit-gated plan |
| Exa | Not implemented | Proposed research fallback |
| Firecrawl | Not implemented | Proposed targeted extraction fallback |
| Google Sheets | Not implemented | Reviewed write-back intent only |
| Google Drive/Docs | Not implemented | Proposed approved-artifact renderer |
| Gmail | Not implemented | Reviewed send intent only |
| Resend | Not implemented | Reserved future adapter |
| PandaDoc | Not implemented | Proposed approved proposal/SOW renderer |

The Integration Center UI currently reads only OpenAI dynamically and hardcodes the remaining cards. It should render the full backend response before more connectors are added.

## Authorization invariant

Credentials stay server-side. The browser never receives API keys or refresh tokens. An authorized connector is not permission to execute consequential actions automatically.

External actions require:

1. a reviewed immutable input artifact;
2. an explicit action intent;
3. a separate approval for the exact action and destination;
4. idempotency and retry safety;
5. an activity/audit record of success or failure.

## Research-provider routing

Keep OpenAI as the primary research path. A future quality gate may route to Exa when authoritative-source or Canvas coverage is weak. Firecrawl should receive a known URL/domain and extract only when standard retrieval is inadequate. Apollo remains opt-in and must show the expected credit consequence before use.

## Recommended implementation order

1. Fireflies, because transcripts are the primary audit evidence.
2. Google Sheets, to make the lightweight CRM operational.
3. Google Drive/Docs, for collaborative artifacts.
4. Gmail or Resend, for approved delivery.
5. PandaDoc, for commercial acceptance and signature.
6. Exa and Firecrawl, after the core research-to-call contract is fixed.
7. Apollo, only for a named unresolved gap.
