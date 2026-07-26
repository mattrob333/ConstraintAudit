---
type: Operations Guide
title: Local Development and Deployment
description: Windows-friendly setup, validation, advisor-identity and tenancy configuration, the tenancy migration, OpenAI Sites deployment context, secret handling, and portability notes.
tags: [operations, local-development, deployment, sites, cloudflare, tenancy, migration]
---

# Local development and deployment

## Repository

```text
C:\Users\mrobe\Documents\Codex\2026-07-24\sales-plugin-sales-openai-curated-remote\work\tier4-advisor-app
```

At the 2026-07-26 update the checkout is on `claude/repo-overview-b7tlrs`. `11c0fd34c796dd09ae31e11fb70cec5f23c045bc` was the OpenAI-web-research baseline; `05d985d` closed the known gaps (canonical Canvas, research-driven flow, tenancy, real adapters) and `925b839` added the refusal to guess whether a measured change is an improvement. Use current Git `HEAD` for the complete source. The checkout has no persistent user-configured Git remote.

## Requirements

- Node.js 22.13+
- npm
- Cloudflare-compatible runtime for D1-backed production

## Local start

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev -- --port 5173 --strictPort
```

The application starts with no credentials at all. Research falls back to deterministic website extraction and still produces a value flow and discovery questions; every approved intent reports `not-configured` and performs no network call.

Always verify the rendered page identity, not merely that a Node process or HTTP port exists.

## Advisor identity and tenancy

Every D1 row carries `owner_id`, and every query in `lib/store.ts` is scoped in SQL. Three variables control who that owner is.

| Variable | Effect |
| --- | --- |
| `LOCAL_ADVISOR_EMAIL` | The single advisor used when no identity header is present. Defaults to `local-advisor@localhost` |
| `REQUIRE_ADVISOR_AUTH` | Set to `1` to disable the fallback entirely; an unauthenticated request then receives 401 |
| `LEGACY_OWNER_EMAIL` | Claims rows written before tenancy existed, the first time `owner_id` is added. Defaults to `LOCAL_ADVISOR_EMAIL` |

Two operational rules follow:

- **Set `REQUIRE_ADVISOR_AUTH=1` in any deployment reachable by more than one person.** The dev fallback exists so the app runs with no auth infrastructure; it is not an access-control policy.
- **Set `LEGACY_OWNER_EMAIL` to the real advisor's address before the first deploy that enables `REQUIRE_ADVISOR_AUTH`**, or pre-tenancy rows are claimed by the local fallback identity instead and become unreachable.

## Database migration

`drizzle/0001_tenancy.sql` adds `owner_id` to `engagements`, `artifacts`, `transcripts`, `activities`, and `intents`, plus `result_json`, `updated_at`, and `executed_at` on `intents`, and creates the owner indexes.

SQLite has no `ADD COLUMN IF NOT EXISTS`, so `ensureDatabase()` in `lib/store.ts` performs the same reconciliation at runtime, guarded by `PRAGMA table_info`, and then backfills any row still holding `owner_id = ''` to the `LEGACY_OWNER_EMAIL` owner. On a database the application has already booted against, the SQL migration's ALTERs are expected to be a no-op. Run one or the other; do not expect the migration file alone to be the only path.

## Validation

```powershell
npm run lint
npx tsc --noEmit
npm test
```

`npm test` builds the application, runs two rendered-HTML checks, then runs `tests/backend-workflow.test.mjs` and `tests/gap-closure.test.mjs` — 26 backend tests.

## Secrets

- `.env.local` is ignored by Git.
- Never print or commit secret values.
- Production variables belong in the hosting provider's server-side environment.
- The browser never receives an API key or refresh token; `/api/integrations` returns only configured/not-configured booleans and the *names* of expected variables.
- OpenWiki credentials belong in `~/.openwiki/.env`, not this repository.

## Current production

- URL: `https://tier4-advisor-cockpit.mattrob333.chatgpt.site`
- Hosting: OpenAI Sites
- Persistence binding: Cloudflare D1 as `DB`
- Access: owner-only at the last recorded release
- Sites project ID: stored in `.openai/hosting.json`

Application-layer tenancy now exists, so the outer owner-only Sites policy is no longer the only boundary — but exposing the app to a second advisor still requires enabling `REQUIRE_ADVISOR_AUTH` and confirming the legacy-owner backfill landed correctly.

## Retrieving a printable deliverable

`GET /api/documents/:id?format=html` returns a self-contained printable HTML rendering of an artifact, owner-scoped like every other read. This is the supported way to get a deliverable out of the app without a document provider. There is no native DOCX or PDF generator.

## Moving to another host

Cloudflare Workers is the simplest alternative. A Vercel, Netlify, or Node deployment requires replacing Cloudflare environment access and D1 or adding a compatible database adapter, and replacing the Sites identity headers read by `lib/auth.ts` with the new host's identity mechanism.

Secrets and D1 data must be migrated separately. `.openai/hosting.json` is Sites-specific and should not be treated as portable runtime configuration.

## Operational cautions

- Retention, deletion, and rate limiting are still unimplemented. Transcripts persist indefinitely.
- There is no organization or team layer; tenancy is per individual advisor.
- Foreign keys are not enforced in the schema.

## OpenWiki maintenance

The repository contains a hand-curated OpenWiki seed. To install and update with the upstream CLI:

```powershell
npm install -g openwiki
openwiki code --update --print
```

Review the generated diff before committing it. Do not enable scheduled CI until a Git remote, provider secret policy, branch policy, and telemetry preference are explicitly chosen.
