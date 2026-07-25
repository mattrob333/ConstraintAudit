---
type: Operations Guide
title: Local Development and Deployment
description: Windows-friendly setup, validation, OpenAI Sites deployment context, secret handling, and portability notes for the Tier 4 Advisor Cockpit.
tags: [operations, local-development, deployment, sites, cloudflare]
---

# Local development and deployment

## Repository

```text
C:\Users\mrobe\Documents\Codex\2026-07-24\sales-plugin-sales-openai-curated-remote\work\tier4-advisor-app
```

At the 2026-07-25 handoff the checkout is on `main`. The last implementation baseline before the documentation handoff is `11c0fd34c796dd09ae31e11fb70cec5f23c045bc`. Use current Git `HEAD` for the complete handoff source. The checkout has no persistent user-configured Git remote.

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

Always verify the rendered page identity, not merely that a Node process or HTTP port exists.

## Validation

```powershell
npm run lint
npx tsc --noEmit
npm test
```

`npm test` builds the application, runs rendered HTML checks, and runs backend workflow tests.

## Secrets

- `.env.local` is ignored by Git.
- Never print or commit secret values.
- Production variables belong in the hosting provider's server-side environment.
- OpenWiki credentials belong in `~/.openwiki/.env`, not this repository.

## Current production

- URL: `https://tier4-advisor-cockpit.mattrob333.chatgpt.site`
- Hosting: OpenAI Sites
- Persistence binding: Cloudflare D1 as `DB`
- Access: owner-only at handoff
- Sites project ID: stored in `.openai/hosting.json`

## Moving to another host

Cloudflare Workers is the simplest alternative. A Vercel, Netlify, or Node deployment requires replacing Cloudflare environment access and D1 or adding a compatible database adapter.

Secrets and D1 data must be migrated separately. `.openai/hosting.json` is Sites-specific and should not be treated as portable runtime configuration.

## OpenWiki maintenance

The repository contains a hand-curated OpenWiki seed. To install and update with the upstream CLI:

```powershell
npm install -g openwiki
openwiki code --update --print
```

Review the generated diff before committing it. Do not enable scheduled CI until a Git remote, provider secret policy, branch policy, and telemetry preference are explicitly chosen.
