---
type: Operations Guide
title: Local Development and Deployment
description: Windows-friendly setup, validation, advisor-identity and tenancy configuration, the three migrations, the Cloudflare Workers deployment path, secret handling, and portability notes.
tags: [operations, local-development, deployment, cloudflare, workers, tenancy, migration]
---

# Local development and deployment

## Repository

```text
C:\Users\mrobe\Documents\Codex\2026-07-24\sales-plugin-sales-openai-curated-remote\work\tier4-advisor-app
```

At the 2026-07-27 update the checkout is on `claude/repo-overview-b7tlrs` at `5f50feb`. The relevant sequence since the last wiki pass:

| Commit | What landed |
| --- | --- |
| `c5ae88f` | Scoped `/api/integrations`, single-sourced its status |
| `2c9ae42` | Model-assisted transcript synthesis with grounding; metric-direction inference |
| `a46a6b0` | `primaryContactRole`, real source-document ingest, `FIXED_SPRINT_PRICE_USD` |
| `c00dc2b` | Resume routing keyed on `workflowState`; the filename-only upload claim removed |
| `d4c21fc` | Practice-mode data, Cloudflare deployment config, verified Cloudflare Access auth |
| `2ca2560` | Advisor-only live-call coaching |
| `5f50feb` | The Practice-mode walkthrough |

Use current Git `HEAD` for the complete source. The checkout has no persistent user-configured Git remote.

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

The application starts with no credentials at all. Research falls back to deterministic website extraction and still produces a value flow and discovery questions; transcript synthesis falls back to the deterministic analyzer and says so on screen; metric direction falls back to its three deterministic tiers; every approved intent reports `not-configured` and performs no network call.

Practice mode works fully offline and costs nothing, so it is the fastest way to see the whole workflow on a fresh checkout.

Always verify the rendered page identity, not merely that a Node process or HTTP port exists.

## Advisor identity and tenancy

Every D1 row carries `owner_id`, and every query in `lib/store.ts` is scoped in SQL. Five variables control who that owner is and how they are established.

| Variable | Effect |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust team domain. Where Access signing keys are fetched from and the expected `iss` |
| `CF_ACCESS_AUD` | The Access application's AUD tag |
| `REQUIRE_ADVISOR_AUTH` | Set to `1` to disable the unauthenticated fallback; an unauthenticated request then receives 401 |
| `LOCAL_ADVISOR_EMAIL` | The single advisor used when no identity is present. Defaults to `local-advisor@localhost` |
| `LEGACY_OWNER_EMAIL` | Claims rows written before tenancy existed. Defaults to `LOCAL_ADVISOR_EMAIL` |

Four operational rules follow:

- **Set `REQUIRE_ADVISOR_AUTH=1` in any deployment reachable by more than one person.** The dev fallback exists so the app runs with no auth infrastructure; it is not an access-control policy.
- **Set both `CF_ACCESS_*` variables or neither.** Exactly one of them set while `REQUIRE_ADVISOR_AUTH` is on puts `advisorAuthMode()` into `denied`, and nothing can authenticate. That is deliberate — a half-finished Access rollout fails closed rather than quietly downgrading to header trust.
- **Set `LEGACY_OWNER_EMAIL` to the real advisor's address before the first deploy that enables `REQUIRE_ADVISOR_AUTH`**, or pre-tenancy rows are claimed by the local fallback identity instead and become unreachable.
- **Turn `workers_dev` off once Access is in place.** Access cannot protect a `*.workers.dev` URL, so leaving it enabled leaves a second door into the same Worker. `lib/auth.ts` fails closed on that door once `CF_ACCESS_*` is set, but do not rely on the application layer alone.

Full detail: [Identity and access](../architecture/identity-and-access.md).

## Database migrations

| File | Adds |
| --- | --- |
| `drizzle/0000_tier4_advisor.sql` | The five tables |
| `drizzle/0001_tenancy.sql` | `owner_id` on all five tables, `result_json` / `updated_at` / `executed_at` on `intents`, and the owner indexes |
| `drizzle/0002_contact_role.sql` | `primary_contact_role` on `engagements` |

SQLite has no `ADD COLUMN IF NOT EXISTS`, so `ensureDatabase()` in `lib/store.ts` performs the same reconciliation at runtime, guarded by `PRAGMA table_info`, and then backfills any row still holding `owner_id = ''` to the `LEGACY_OWNER_EMAIL` owner. On a database the application has already booted against, the SQL migrations' ALTERs are expected to be a no-op. Run one path or the other; do not expect the migration files alone to be the only path.

## Validation

```powershell
npm run lint
npx tsc --noEmit
npm test
```

`npm test` builds the application, runs `tests/rendered-html.test.mjs` under `node --test` (2 tests), then `tests/backend-workflow.test.mjs`, `tests/gap-closure.test.mjs`, `tests/reasoning.test.mjs`, and `tests/practice-mode.test.mjs` under `tsx --test` (15 + 11 + 7 + 7 = 40). **43 tests in total.** The build is not optional — the rendered-HTML suite asserts against `dist/server/index.js`.

## Secrets

- `.env.local` is ignored by Git.
- Never print or commit secret values.
- Production variables belong in the hosting provider's server-side environment. On Workers that is `npx wrangler secret put <NAME> -c wrangler.jsonc -e production`; secrets take effect on the next request with no redeploy, and `wrangler secret list` shows which names are set, never the values.
- The browser never receives an API key or refresh token; `/api/integrations` returns only configured/not-configured booleans, the auth mode, and the *names* of expected variables.
- OpenWiki credentials belong in `~/.openwiki/.env`, not this repository.

## Deploying to Cloudflare Workers

`docs/DEPLOYMENT.md` is the walkthrough; `wrangler.jsonc` is the configuration, and its own comments explain each block. Two things about that file are unusual and both are deliberate:

- **Everything real lives under `env.production`, not at the top level.** The Cloudflare Vite plugin auto-discovers a root `wrangler.jsonc` and *merges* it with the bindings `vite.config.ts` builds inline, concatenating arrays rather than replacing them. A top-level `d1_databases` block would give `npm run dev` two D1 bindings both named `DB`, and local development would silently start using a different database. Paste new bindings **inside** `env.production`.
- **Deploy commands must name the file and the environment:**

  ```powershell
  npm run build
  npx wrangler deploy -c wrangler.jsonc -e production
  ```

  `npm run build` writes its own generated config to `dist/server/wrangler.json` and a redirect at `.wrangler/deploy/config.json`. A bare `npx wrangler deploy` follows that redirect and deploys with the *placeholder* D1 database id from `vite.config.ts`, not the real one.

The shape of the deployment: `no_bundle` with an ESModule rule, because Vite has already bundled the server and `dist/server/index.js` reaches the renderer through a runtime `import("./ssr/index.js")` that must be uploaded alongside it; static assets from `dist/client` bound as `ASSETS`; D1 bound as `DB` (the binding name is not negotiable — `db/index.ts` reads it); and an optional Cloudflare Images binding that can simply be deleted if the account does not have Images enabled.

`wrangler.jsonc` ships with `"database_id": "REPLACE_ME_WITH_THE_D1_DATABASE_ID"`. Create the database with `npx wrangler d1 create tier4-advisor-cockpit`, paste the uuid, then apply the three migrations with `npx wrangler d1 execute … --remote --file=./drizzle/000N_*.sql`.

**Status:** the configuration and the guide are complete and internally consistent, and this repository contains no evidence that the deploy or the Access sign-in has been executed. Treat the Workers path as documented-but-unproven.

## Current production

- URL: `https://tier4-advisor-cockpit.mattrob333.chatgpt.site`
- Hosting: OpenAI Sites — the legacy host, being moved off
- Persistence binding: Cloudflare D1 as `DB`
- Access: owner-only at the last recorded release
- Sites project ID: stored in `.openai/hosting.json`

Application-layer tenancy exists, so the outer owner-only Sites policy is no longer the only boundary. Exposing the app to a second advisor still requires enabling `REQUIRE_ADVISOR_AUTH`, confirming the legacy-owner backfill landed correctly, and — because Google writes all use one shared service token — accepting that every advisor's approved intent writes as the same Google principal.

`docs/DEPLOYMENT.md` covers moving existing data off Sites: whether `npx wrangler d1 export` can reach the Sites-provisioned database depends on whether it is visible under your own Wrangler login, which must be checked first.

## Retrieving a printable deliverable

`GET /api/documents/:id?format=html` returns a self-contained printable HTML rendering of an artifact, owner-scoped like every other read. This is the supported way to get a deliverable out of the app without a document provider. There is no native DOCX or PDF generator.

## Moving to another host

A Vercel, Netlify, or Node deployment requires replacing Cloudflare environment access and D1 or adding a compatible database adapter, replacing the Cloudflare Access verification in `lib/access-jwt.ts`, and replacing the Sites identity headers read by `lib/auth.ts` with the new host's identity mechanism.

Secrets and D1 data must be migrated separately. `.openai/hosting.json` is Sites-specific and should not be treated as portable runtime configuration.

## Operational cautions

- Retention, deletion, and rate limiting are still unimplemented. Transcripts persist indefinitely.
- `deleteEngagementCascade()` exists but only Practice mode calls it. There is no advisor-facing deletion of a real engagement.
- There is no organization or team layer; tenancy is per individual advisor.
- Foreign keys are not enforced in the schema.
- Google actions are performed by one shared service account, not by the advisor.

## OpenWiki maintenance

The repository contains a hand-curated OpenWiki seed. To install and update with the upstream CLI:

```powershell
npm install -g openwiki
openwiki code --update --print
```

Review the generated diff before committing it. Do not enable scheduled CI until a Git remote, provider secret policy, branch policy, and telemetry preference are explicitly chosen.
