# Tier 4 Advisor Cockpit Integration Contract

**Status:** Research and implementation boundary  
**Verified against source:** 2026-07-27  
**Governing documents:** `public/docs/workflow.md` and `public/docs/architecture.md`

> This file and `public/docs/integrations.md` are the same document, kept byte-identical: the repository root copy is for developers, the `public/docs/` copy is served by the application. Edit both together.

## 0. What is actually implemented today

The sections below describe the full provider contract, including lanes that are not built. This is the shipped state, read from `lib/integrations/**`, `lib/fireflies.ts`, `lib/openai-research.ts`, `lib/openai-transcript.ts` and `app/api/integrations/route.ts`:

| Provider | Deployed-app adapter in this repository | What it does |
| --- | --- | --- |
| OpenAI Responses API | **Yes** | Public web research, and model-assisted transcript synthesis whose every citation is verified against a real client-attributed transcript line |
| Resend | **Yes** | Sends the approved readiness brief from an approved intent, with the intent id as the idempotency key |
| Google Sheets | **Yes** | Appends or updates the matched CRM row from an approved intent |
| Google Drive / Docs | **Yes** | Creates the Google Doc from an approved publication intent, using the narrow `drive.file` scope |
| Fireflies | **Yes**, unverified live | Server-side transcript import; needs `FIREFLIES_API_KEY`. No run against a real workspace is recorded |
| Gmail | No | Intent-only. Resend is the implemented sender |
| Apollo | No | Connector-first. Setting `APOLLO_API_KEY` reports `configured_not_implemented` and changes nothing |
| PandaDoc | No | Connector-first. Setting `PANDADOC_API_KEY` reports `configured_not_implemented` and changes nothing |
| Exa, Firecrawl | No | Not implemented in any form |

An adapter never decides whether it may act (`lib/integrations/types.ts`). It receives an already-approved payload, performs exactly one external write, and reports what happened. Approval and execution are two separate decisions, recorded on the intent.

## 1. Non-negotiable boundary

There are two different integration lanes:

1. **Codex installed connectors** run as authenticated tools inside an advisor/Codex task. Codex owns their authorization session and approval gates. The deployed cockpit cannot call these tools or reuse their tokens.
2. **Deployed-app APIs** are calls made by the cockpit's trusted server runtime to a vendor API. They require separately provisioned credentials, server-side secret storage, provider-specific consent, and an application-level approval/audit layer.

Never place provider keys, OAuth client secrets, access tokens, or refresh tokens in browser code, `NEXT_PUBLIC_*` variables, rendered HTML, client logs, or connector-action payloads. The browser should submit an action intent to the trusted server. The server should enforce workflow state, advisor approval, idempotency, and audit logging before any external write or send.

The build is no longer uniformly connector-first. Where it stands now:

- **Deployed-app adapters, implemented:** OpenAI (research and transcript synthesis), Resend, Google Sheets, Google Drive/Docs, Fireflies import.
- **Connector-first, no adapter:** Apollo and PandaDoc. Gmail is connector-first too; Resend is the sender this app actually uses.
- Fireflies, Apollo, PandaDoc, Google Drive/Sheets, and Gmail also remain available through installed Codex connectors, which the deployed app cannot call or borrow tokens from.

Connector availability above is an observation of the current Codex environment, not a promise that the same connectors exist in every Codex account, workspace, or future release.

## 2. Standard environment-variable names

These names are reserved for **server-side direct API adapters only**. A variable's presence must not bypass an advisor approval gate.

| Variable | Required when | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI web research or model-assisted transcript synthesis is enabled | Project-scoped server secret; never exposed to the browser. The same key serves both paths |
| `OPENAI_RESEARCH_MODEL` | A model override is required | Optional; defaults to `gpt-5.6-sol` |
| `OPENAI_TRANSCRIPT_MODEL` | Transcript synthesis should use a different model from research | Optional; falls back to `OPENAI_RESEARCH_MODEL`. With no key at all, synthesis falls back to the deterministic reading and the UI says so |
| `FIREFLIES_API_KEY` | A deployed server fetches Fireflies transcripts directly | Secret bearer token; not needed for the Codex connector |
| `APOLLO_API_KEY` | A deployed server calls Apollo directly | Secret API key; not needed for the Codex connector |
| `PANDADOC_API_KEY` | A single-workspace deployed server calls PandaDoc directly | Secret; use only one PandaDoc auth mode |
| `PANDADOC_TEMPLATE_UUID` | A native Tier 4 PandaDoc template has been approved | Non-secret identifier; optional until the template exists |
| `GOOGLE_CLIENT_ID` | Deployed-app Google OAuth is enabled | OAuth client credential; server-side flow |
| `GOOGLE_CLIENT_SECRET` | Deployed-app Google OAuth is enabled | Secret |
| `GOOGLE_REDIRECT_URI` | The deployed app exposes an interactive Google connect/reconnect flow | Must exactly match a redirect URI registered on the Google OAuth client |
| `GOOGLE_REFRESH_TOKEN` | Single-advisor, server-side Google OAuth is enabled | Secret. For a multi-user app, store per-user encrypted refresh tokens in a database instead of one environment variable |
| `GOOGLE_SHEETS_ID` | The deployed server reads/writes the V1 CRM directly | Non-secret file ID; currently the Tier 4 Engagement CRM |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | The deployed server creates engagement files in a fixed Drive folder | Non-secret file ID; optional until a root folder is chosen |
| `RESEND_API_KEY` | The deployed server sends via Resend | Secret, sending-only and domain-restricted |
| `EMAIL_FROM` | Resend sending is enabled | Full sender, for example `Tier 4 <advisor@verified.example>` |
| `EMAIL_REPLY_TO` | Replies should go somewhere other than `EMAIL_FROM` | Optional |

Advisor identity and tenancy variables (`REQUIRE_ADVISOR_AUTH`, `LOCAL_ADVISOR_EMAIL`, `LEGACY_OWNER_EMAIL`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`) are not integration credentials and are documented in `README.md` and `docs/DEPLOYMENT.md`. They matter here for one reason: `/api/integrations` is advisor-scoped, because which providers a deployment has wired up describes the deployment and is not public information.

## 3. Integration matrix

| Integration | Purpose in the approved workflow | Codex connector lane | Deployed-app lane |
| --- | --- | --- | --- |
| OpenAI Responses API | Public company research with structured source-backed Canvas facts, and model-assisted transcript synthesis | Secure Platform setup provisions the key; connector tokens are not reused | **Implemented.** `store: false`, web search, strict JSON schema, source filtering, deterministic fallback. Transcript synthesis adds a grounding parser that discards any citation it cannot match to a client-attributed line |
| Fireflies | Retrieve full Call 1 and Call 2 transcripts, speakers, timestamps, and source URLs | Available: search meetings, then fetch the complete transcript | **Implemented, unverified live.** Read-only server adapter using `FIREFLIES_API_KEY` (`lib/fireflies.ts`) |
| Apollo | Fill a named company or roster evidence gap after cost disclosure and approval | Preferred now: connector exposes search, usage, and credit-gated enrichment actions | **Not implemented.** A future server adapter using `APOLLO_API_KEY` must reproduce the credit gate |
| PandaDoc | Create reviewed proposal/SOW drafts and, only after a second approval, send for signature | Preferred now: create from Markdown or a selected template, inspect status, and send behind approval | **Not implemented.** A future adapter must use a native template or file upload; the public API is not a raw-Markdown endpoint |
| Google Sheets | V1 CRM and engagement registry | Available: connector-managed Sheets actions | **Implemented.** `appendOrUpdateRow` writes the matched row from an approved `crm_write_back` intent |
| Google Drive / Docs | Approved working artifacts as native Google Docs | Available: connector-managed Drive/Docs actions | **Implemented.** `createDocument` creates the Doc from an approved `document_publish` intent using `drive.file` |
| Gmail | Read prior context; create reviewed drafts; send only after explicit confirmation | Preferred now: connector-managed search/read/draft/send | **Not implemented.** No adapter; the app never sends through Gmail |
| Resend | Transactional email when Gmail is intentionally not the sender | No installed connector in the current environment | **Implemented.** Backend-only `POST /emails` from an approved `readiness_brief_send` intent |

## 4. OpenAI Responses API — active public research and transcript synthesis

### Purpose

The Responses API enriches the validated company website with public web search. It returns a short company summary, source-linked facts assigned to Business Model Canvas blocks, missing baselines, and constraint hypotheses to test live. It does not replace transcripts, calculations, source records, confirmation status, or human approval.

### Authorization state

The key is project-scoped and held in local or production server environment storage. The browser never receives it. `OPENAI_RESEARCH_MODEL` defaults to `gpt-5.6-sol` and can be changed without client-code changes.

### Endpoint and controls

The endpoint is `POST https://api.openai.com/v1/responses`. The request sets `store: false`, enables the built-in `web_search` tool, requests web-search source records, and requires a strict JSON schema. Only facts whose URLs match returned web-search sources or the validated company website survive parsing.

### Health check

The local verification uses a public company website, not a client transcript. A failed OpenAI request does not block research: the app retains the deterministic website result and labels the provider status as failed.

### Provider roadmap

- **Exa:** preferred second provider when advisors need deliberate company/domain discovery, ranked results, or a separate search index. Add it behind an explicit provider selector or fallback policy, not as an automatic duplicate call.
- **Firecrawl:** add when the known company site cannot be read reliably, requires JavaScript rendering, or needs a controlled multi-page crawl. Use it as a retrieval layer for named URLs, not as the default search engine.
- Do not run OpenAI, Exa, and Firecrawl on every engagement. Route by need, cap results/pages, show the selected provider, and preserve source URLs.

### Transcript synthesis

The same key drives model-assisted transcript synthesis (`lib/openai-transcript.ts`). The request sets `store: false`, a strict JSON schema, `reasoning.effort: "medium"`, a 16,000-token output ceiling and a 60-second timeout, and the model is given the research, the canonical Canvas, the value flow, the discovery questions and prior-call summaries alongside the numbered transcript.

Every claim it returns is then checked by `groundModelSynthesis` (`lib/openai-transcript-schema.ts`) against the actual transcript lines. A quote, metric, Canvas correction or flow confirmation survives only if it matches a line whose provenance is `client-stated`; an advisor or unknown-speaker line is rejected, and the rejection is recorded rather than silently dropped. The model's narrative and interpretation stay `advisor-note`. The two readings are merged as a union so neither pass loses what the other found; the constraint candidate is the single-winner decision, and any disagreement is written into the gaps for the advisor to settle.

With no key configured, or on any HTTP, timeout, parse, or schema failure, the deterministic synthesis stands and the record carries `analysisMode: "deterministic"` with `modelStatus: "not-configured"` or `"failed"`, which the UI states on screen.

`OPENAI_TRANSCRIPT_MODEL` overrides the model for this path only.

### Limitations

- Model output is interpretation, not evidence.
- A human must be able to inspect the source transcript or document supporting every generated finding.
- Grounding is exact, not semantic: a correct paraphrase that does not appear verbatim in a client line is rejected. That is the intended trade.
- Cost, rate limits, model availability, and retention policy must be re-verified when the integration is authorized. Transcript synthesis is the larger of the two request types.

**Official sources:** [Responses API overview and migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), [API platform endpoint example](https://developers.openai.com/api/docs), [production key practices](https://developers.openai.com/api/docs/guides/production-best-practices), [human-in-the-loop safety guidance](https://developers.openai.com/api/docs/guides/safety-best-practices)

## 5. Fireflies

### Purpose

Fetch the full processed transcript for each diagnostic call. Store the Fireflies transcript ID and URL, meeting identity, sentence text, raw transcription text, speaker ID/name, start/end values, and retrieval time. The approved workflow requires the full transcript, not only Fireflies' generated summary.

### Authentication and minimum access

- **Direct API:** API-key bearer authentication to `https://api.fireflies.ai/graphql`.
- **Header:** `Authorization: Bearer <FIREFLIES_API_KEY>`.
- **Minimum access:** a key created by a user who can read the target meetings. Fireflies does not publish OAuth-style scopes for this API. A user key accesses that user's data; an admin-generated key can access same-team user data.
- **Codex connector:** connector-managed authentication; no app environment variable.

### Connector and endpoint approach

Preferred current flow:

1. Use the Fireflies connector to search by participant, organizer, date, or title.
2. Capture the returned transcript ID.
3. Use the connector's full-transcript action, not its summary-only action.
4. Persist the transcript ID, source URL, and a retrieval timestamp with extracted evidence.

Direct API equivalent:

```graphql
query Tier4Transcript($id: String!) {
  transcript(id: $id) {
    id
    title
    dateString
    organizer_email
    participants
    transcript_url
    is_live
    sentences {
      index
      speaker_id
      speaker_name
      text
      raw_text
      start_time
      end_time
    }
  }
}
```

Use `text` as the current transcript text and retain `raw_text` for audit comparison because Fireflies documents `text` as the default or user-edited transcription and `raw_text` as the audio transcription.

### Health check

- **Connector:** run a read-only meeting search limited to one result, then fetch one known transcript.
- **Direct API:** `query { user { user_id email } }` with the configured bearer key. This authenticates without fetching client content.
- **Workflow test:** fetch one known completed meeting and verify `is_live == false`, a non-empty `sentences` array, speaker fields, timestamp fields, and `transcript_url`.

### Limitations

- The public `Sentence` schema does **not** expose speaker-confidence. The workflow's `speaker_confidence` must therefore be recorded as `unknown` or supplied by an advisor verification step; never invent it.
- `text` can be user-edited. Preserve `raw_text` and retrieval time when traceability matters.
- A live transcript is only a point-in-time snapshot. Do not synthesize final evidence while `is_live` is true.
- Fireflies states that Super Summary and Custom Apps data are not currently available through the public API.
- Plan-based limits are material: Fireflies currently documents 50 requests/day for Free/Pro and 60 requests/minute for Business/Enterprise.
- Access is bounded by the key owner's meeting/team permissions.

**Official sources:** [authorization](https://docs.fireflies.ai/fundamentals/authorization), [transcript query](https://docs.fireflies.ai/graphql-api/query/transcript), [sentence schema](https://docs.fireflies.ai/schema/sentence), [user query](https://docs.fireflies.ai/graphql-api/query/user), [limits](https://docs.fireflies.ai/fundamentals/limits)

## 6. Apollo

### Purpose

Apollo is a paid, gap-driven enrichment source, not CRM truth and not evidence of the operating constraint. Use it only after public research fails to resolve a named gap, the expected credit cost is displayed, and the advisor approves the call.

### Authentication and minimum access

- **Direct API for one Tier 4 workspace:** API key in the `x-api-key` header.
- **Health endpoint:** `GET https://api.apollo.io/v1/auth/health`.
- **Minimum access:** create a non-master key with only the needed search/enrichment endpoint permissions where the Apollo dashboard allows it. Plan and key scopes determine access.
- **Master key:** do not request one for the normal Tier 4 search/enrichment flow. Apollo documents that some endpoints, including complete organization retrieval and API usage statistics, require a master key.
- **OAuth 2.0:** intended for partners acting on behalf of mutual Apollo customers; unnecessary for a single internal workspace.
- **Codex connector:** connector-managed authentication and credit confirmation; no app environment variable.

### Connector and endpoint approach

Preferred current flow:

1. Run free recon first and record the unresolved evidence gap.
2. Use the connector's usage/credit action when available.
3. Show the full intended enrichment count and maximum cost.
4. Ask for explicit approval.
5. Call only the smallest connector search or enrichment action that can close the gap.

Direct API equivalents:

- Company search: `POST https://api.apollo.io/api/v1/mixed_companies/search`
- Single-company enrichment: `GET https://api.apollo.io/api/v1/organizations/enrich`
- Bulk company enrichment, up to 10: `POST https://api.apollo.io/api/v1/organizations/bulk_enrich`

Current Apollo documentation says organization search consumes one credit per returned page, with up to 100 results per page; a page with no results consumes no credit. Organization enrichment consumes one credit per matched company and zero for an unmatched company. Re-check the live credit text before implementing or displaying cost because pricing can change.

### Health check

- **Connector:** call the connector's read-only usage/profile action. Do not spend an enrichment credit for a health check.
- **Direct API:** call `GET /v1/auth/health` with `x-api-key`.
- **Capability check:** verify that the key/plan permits organization search and organization enrichment before exposing either UI action.

### Limitations

- The API does not enforce the Tier 4 approval policy; the cockpit must.
- Search and enrichment can consume credits. Retries must be idempotent at the application layer and must not silently repeat a paid call.
- Organization search currently displays at most 50,000 records (100 per page, 500 pages); narrow filters are required.
- Data is enrichment, not client-confirmed truth. Keep provenance `paid-enrichment` until confirmed.
- Endpoint access and limits vary by Apollo plan and API-key scopes.
- Apollo's public endpoint pages identify insufficient-scope errors but do not publish a stable, complete list of dashboard permission-label names for a least-privilege key. Confirm the exact checkboxes in the Apollo dashboard during provisioning.

**Official sources:** [authentication and health check](https://docs.apollo.io/reference/authentication), [organization search](https://docs.apollo.io/reference/organization-search), [organization enrichment](https://docs.apollo.io/reference/organization-enrichment), [bulk organization enrichment](https://docs.apollo.io/reference/bulk-organization-enrichment), [rate limits](https://docs.apollo.io/reference/rate-limits)

## 7. PandaDoc

### Purpose

Create a reviewed proposal, SOW, fixed-sprint authorization, or other artifact with a commercial/acceptance event. Document creation produces a draft. Sending is a separate, higher-consequence action requiring explicit confirmation.

### Authentication and minimum access

- **Single internal PandaDoc workspace:** `Authorization: API-Key <PANDADOC_API_KEY>`.
- **Multi-account integration:** OAuth 2.0 using `Authorization: Bearer <access_token>`, with refresh-token handling. If that model is later selected, add separately reviewed `PANDADOC_CLIENT_ID`, `PANDADOC_CLIENT_SECRET`, and `PANDADOC_REDIRECT_URI` variables.
- PandaDoc does not document fine-grained OAuth scopes on the cited auth pages. Access follows the authorized user, workspace permissions, plan, and enabled API features.
- **Codex connector:** connector-managed auth; no app environment variable.

### Connector and endpoint approach

Preferred current flow:

- With no native Tier 4 template: use the installed PandaDoc connector's create-from-Markdown action to create a draft, then poll connector status until `document.draft`.
- Once an approved template exists: list templates, inspect the selected template's roles/fields/variables, map recipients and advisor-controlled values, then create from the template.
- Never call the connector send action as part of draft creation. Send only after a second explicit advisor confirmation.

Deployed public API:

- List templates: `GET https://api.pandadoc.com/public/v1/templates`
- Create from template: `POST https://api.pandadoc.com/public/v1/documents` with `template_uuid`, recipients, and optional fields/variables/content placeholders
- Create from content: first render approved content to PDF, DOCX, or RTF, then use the create-from-file/upload form of `POST /public/v1/documents`
- Status: `GET https://api.pandadoc.com/public/v1/documents/{id}`
- Send: `POST https://api.pandadoc.com/public/v1/documents/{id}/send`

The public API does not document raw Markdown as a document-creation format. That is a capability of the installed connector, not the deployed API. A deployed adapter must use a native template or render content to a supported file.

### Health check

- **Connector:** list templates. An empty list is a valid authenticated result and must not be reported as a connector outage.
- **Direct API:** `GET /public/v1/templates?count=1` without empty optional query parameters.
- **Creation test:** create a sandbox draft from a controlled sample template/file, verify the returned `document.uploaded` state transitions to `document.draft`, and open it in PandaDoc to verify rendering and field mapping. Do not send.

### Limitations

- Creation is asynchronous. Do not inspect details or send until status becomes `document.draft`; stop on `document.error`.
- Webhooks are the recommended production status mechanism; bounded polling is acceptable as a fallback.
- Sending locks the document for recipient interaction and is not part of a health check.
- Sandbox sending is restricted, and PandaDoc API access depends on the workspace plan/features.
- File upload supports PDF, DOCX, and RTF and does not support encrypted PDFs.
- PandaDoc's current official pages conflict on maximum file size: the newer file-upload guide says 100 MB, while the limits/reference material says 50 MB. Treat **50 MB as the safe limit** until PandaDoc confirms otherwise.
- Official current limits include 10 requests/minute for any sandbox API action; production limits vary by endpoint.

**Official sources:** [authentication overview](https://developers.pandadoc.com/reference/auth-overview), [create from template](https://developers.pandadoc.com/docs/create-document-from-template), [create from file](https://developers.pandadoc.com/docs/create-document-from-file), [list templates](https://developers.pandadoc.com/reference/list-templates), [asynchronous workflow](https://developers.pandadoc.com/docs/reliable-document-workflow), [document status](https://developers.pandadoc.com/reference/document-status), [send document](https://developers.pandadoc.com/reference/send-document), [limits](https://developers.pandadoc.com/reference/limits)

## 8. Google Sheets, Drive, and Gmail OAuth

### Purpose

- **Sheets:** V1 engagement registry and activity log. **Implemented** (`lib/integrations/google-sheets.ts`).
- **Drive/Docs:** canonical engagement record and approved collaborative artifacts. **Implemented** (`lib/integrations/google-docs.ts`); the Markdown is also rendered to HTML so headings, lists and tables survive the conversion.
- **Gmail:** read prior client context, create reviewed drafts, and send only after explicit confirmation. **Not implemented** — there is no Gmail adapter, and the scope guidance below is for a future one.

`GOOGLE_REFRESH_TOKEN` is a single environment variable, so every approved Google write acts as one identity no matter which advisor approved it. This is acceptable for the single-advisor deployment and must be replaced with per-user encrypted token storage before a second advisor expects writes to land in their own Drive.

### Authentication

- **Codex connector:** the installed Google Drive and Gmail connectors own their authorization sessions. The deployed app cannot read or reuse those tokens.
- **Deployed app:** OAuth 2.0 authorization-code flow for web-server applications. The browser receives the consent redirect; the trusted server exchanges the one-time code, stores/rotates tokens, and makes Google API calls.
- Use `access_type=offline` when the server must act after the advisor leaves the browser session, and protect the authorization request with `state`.

For the current single-advisor deployment, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` are the standardized server secrets. `GOOGLE_REDIRECT_URI` is also required if the deployed app owns the connect/reconnect route. If the product becomes multi-user, replace the single refresh-token variable with encrypted per-user token storage and revocation handling.

### Minimum scopes

Request scopes incrementally when the related feature is enabled.

| Capability | Minimum recommended scope | Why |
| --- | --- | --- |
| Read/write the app-created or explicitly opened Tier 4 CRM and Drive files | `https://www.googleapis.com/auth/drive.file` | Google recommends this narrower per-file scope; Sheets `values.get` accepts it |
| Create/list/send Gmail drafts | `https://www.googleapis.com/auth/gmail.compose` | Manages drafts and sends messages |
| Read prior Gmail correspondence and message bodies | `https://www.googleapis.com/auth/gmail.readonly` | Required only when the recon feature reads mailbox content |
| Send without draft management | `https://www.googleapis.com/auth/gmail.send` | Use instead of `gmail.compose` only if the product deliberately removes draft management |

Do not request broad `drive`, `spreadsheets`, `gmail.modify`, or `mail.google.com` scopes for the approved workflow. If `drive.file` cannot access the pre-existing CRM because the file was not created/opened with the app, use Google Picker or explicitly authorize/share that file with the app rather than broadening scope by default.

### Connector and endpoint approach

Preferred current flow:

- Use the Google Drive/Sheets connector for reviewed CRM and artifact writes.
- Use the Gmail connector for prior-context reads and reviewed drafts.
- Keep send/share actions separate from draft/create actions and behind explicit confirmation.

Direct API equivalents:

- CRM read health: `GET https://sheets.googleapis.com/v4/spreadsheets/{GOOGLE_SHEETS_ID}/values/Engagements!A1:A2`
- CRM writes: Sheets `spreadsheets.values.append` or `batchUpdate`, with an engagement ID/idempotency record
- Drive file health: `GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=id,name,mimeType,trashed`
- Gmail draft health: `GET https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=1`
- Gmail send: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with an RFC 2822 message encoded as base64url

### Health check

- **Connector:** read the CRM header and one known Drive file; list one Gmail draft or run a narrow read-only search.
- **Direct OAuth:** refresh the access token, then:
  - Sheets: read the CRM header range and validate expected column names;
  - Drive: fetch the configured file/root metadata and confirm it is not trashed;
  - Gmail compose: list at most one draft.
- Never create a file, append a CRM activity, or send an email merely to report integration health.

### Limitations

- OAuth consent and tokens belong to the app's Google Cloud project, not Codex.
- `drive.file` access is file-specific. It is intentionally narrower than all-Drive access.
- Sheets scopes apply to an entire spreadsheet, not one tab. Use protected ranges and application validation where tab/range protection matters.
- Gmail message bodies are highly sensitive. Request `gmail.readonly` only when prior-context retrieval is implemented and visible to the advisor.
- Public apps requesting sensitive or restricted scopes may require Google verification; restricted scopes can require an annual security assessment. Internal Workspace, personal, development, and testing cases can have exemptions, but all remain subject to Google's user-data policy.
- Google requires the narrowest implemented scopes and may reject scopes requested only for future features.

**Official sources:** [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes), [Drive scope selection](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get), [Drive files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get), [Gmail server-side authorization](https://developers.google.com/workspace/gmail/api/auth/web-server), [Gmail drafts.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/list), [Gmail messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [verification requirements](https://support.google.com/cloud/answer/13464321)

## 9. Resend

### Purpose

Send transactional emails from a verified Tier 4 domain when Gmail is intentionally not the sender. Resend must not become a shortcut around the workflow's reviewed-draft and explicit-send gates.

**Implemented** (`lib/integrations/resend.ts`). It is reachable from exactly one place: executing an approved `readiness_brief_send` intent. The intent id is the `Idempotency-Key`, and the send intent is bound to an immutable approved artifact, so a regenerated brief cannot be sent under an old approval.

### Authentication and minimum access

- **Direct API only in the current environment.**
- **Header:** `Authorization: Bearer <RESEND_API_KEY>`.
- **Base URL:** `https://api.resend.com`.
- Create a **Sending access** key restricted to the verified sending domain. Do not use a Full access key merely to send mail.
- Direct HTTP clients must include a `User-Agent`; official SDKs include it automatically.

### Endpoint approach

Use `POST https://api.resend.com/emails` with:

- `from: EMAIL_FROM`
- `to`
- `subject`
- `html` and/or `text`
- optional `reply_to: EMAIL_REPLY_TO`
- an `Idempotency-Key` derived from the approved send intent

The idempotency key prevents duplicate email creation for 24 hours. Store the returned email ID with the approval record and outbound activity.

### Health check

- **Configuration check:** validate `RESEND_API_KEY`, `EMAIL_FROM`, and the sender domain format without sending.
- A sending-only key cannot call general read endpoints, so there is no non-mutating API-key health call with the least-privilege key.
- **Explicit integration test:** after advisor approval, send a labeled test to `delivered+tier4-health@resend.dev`, record the returned email ID, and inspect the test event. This is a real send and must not run on every application health request.

### Limitations

- Production delivery requires a verified sending domain. The default `resend.dev` domain is for testing and can only send to the Resend account's own email.
- Default API rate limit is currently five requests/second per team; quotas also vary by plan.
- Maximum recipients per send is 50.
- Attachments are limited to 40 MB after base64 encoding.
- Delivery acceptance is not proof of inbox placement. Track bounce, complaint, and suppression events before operational use.
- Resend has no installed connector in the current Codex environment, so the app must own approval, idempotency, audit, and secret management.

**Official sources:** [API authentication and rate limit](https://resend.com/docs/api-reference/introduction), [API-key permissions](https://resend.com/docs/dashboard/api-keys/introduction), [send email](https://resend.com/docs/api-reference/emails/send-email), [test addresses](https://resend.com/docs/dashboard/emails/send-test-emails), [sender/domain behavior](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend), [usage limits](https://resend.com/docs/api-reference/rate-limit)

## 10. Approval and audit requirements

This is implemented for the three adapters that write externally. Intents are rows in the D1 `intents` table, scoped by `owner_id` like every other record. An intent is created `pending_review`, must be separately approved, and only then may be executed (`reviewIntent` in `lib/actions.ts`). Three intent types execute today: `readiness_brief_send`, `crm_write_back`, and `document_publish`; anything else is a 400.

One detail worth preserving: an unconfigured provider returns `not-configured`, performs no network call, and leaves the intent **approved** so it can be executed again once the credential exists. A genuine failure marks the intent `failed` and needs a fresh approval, because the app cannot know whether the write landed.

Every deployed adapter and connector action should emit the same reviewed intent envelope:

```yaml
action_id: ""
engagement_id: ""
provider: "fireflies | apollo | pandadoc | google_sheets | google_drive | gmail | resend"
operation: ""
workflow_state: ""
evidence_gap_or_artifact: ""
cost_preview: null
external_consequence: "read | create-draft | update | share | send"
approved_by: null
approved_at: null
provider_object_id: null
attempt_count: 0
last_error: null
```

Rules:

- Reads must still be scoped to the current engagement.
- Paid Apollo calls require cost disclosure and approval before execution.
- Google Doc, Drive, Sheets, and PandaDoc creation requires the applicable workflow checkpoint.
- Gmail, Resend, PandaDoc send, and Drive share are separate actions requiring explicit confirmation.
- Provider object IDs and idempotency keys must be stored before a retry.
- No provider result changes a claim from inferred/missing to known without the workflow's evidence and approval rules.

## 11. Known uncertainties to resolve before direct-adapter implementation

1. Confirm the exact Apollo API-key permission labels shown in the account's current dashboard; the official endpoint docs do not provide a stable label list.
2. Confirm the PandaDoc production plan, template availability, and effective file-upload ceiling. Official pages currently conflict between 50 MB and 100 MB.
3. Decide whether the Google integration remains single-advisor or becomes multi-user before implementing token storage.
4. Confirm whether Gmail prior-context retrieval is required in the deployed app. If not, omit `gmail.readonly` and keep reads in the Codex connector lane.
5. Decide whether a Gmail adapter is wanted at all, now that Resend is the implemented sender.
6. Decide whether Exa should be the first optional search fallback after representative audits reveal a discovery-recall gap.
7. Decide whether Firecrawl is necessary only after measuring failures on JavaScript-heavy or multi-page client sites.
8. Verify the Fireflies adapter against a real workspace, including a live meeting (`is_live == true`) so the "do not synthesize from a live transcript" rule is exercised rather than assumed.
9. Agree a per-engagement OpenAI budget now that transcript synthesis is a second, larger request type alongside research.
