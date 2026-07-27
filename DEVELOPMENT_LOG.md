# Tier 4 Advisor Cockpit Development Log

This is a durable, append-oriented log for implementation decisions, verification evidence, and handoffs. It is not a substitute for Git history or the canonical workflow specification. Entries are newest first.

## 2026-07-27 — Documentation reconciled with the reasoning, tenancy, Access, and practice-mode work

### Source or request

Repository owner asked for the top-level documentation to be brought back in line with the source after several sessions of shipping. The previous docs described a product that no longer exists: they listed model-assisted transcript synthesis, metric-direction inference, Cloudflare Access, live-call coaching and practice mode as absent or future, and they still described transcript synthesis as deterministic-only. Work was scoped by file ownership: this entry covers `README.md`, `DEVELOPER_HANDOFF.md`, `DEVELOPMENT_LOG.md`, `INTEGRATIONS.md`, and `public/docs/{current-state,integrations,architecture}.md` plus `public/docs/index.json`. No application code, wiki page, `docs/DEPLOYMENT.md`, or configuration was touched.

### Durable decisions

- **Every documented claim is verified against source, not against another document.** Where the old docs and the code disagreed, the code won. Test counts were taken by reading the test files, not by repeating a prior number.
- **Partial capabilities are described as partial.** The Escape panic key is documented as one-way and same-window; screen-share safety is documented as advisor-asserted because the app cannot detect a share; practice mode is documented as unsuitable for rehearsing with a live audience because the practice bar deliberately survives the client-facing screens.
- **What is still missing stays written down.** Gmail has no adapter; Apollo and PandaDoc are connector-first; there is no native DOCX or PDF generator; Exa and Firecrawl are not implemented; there is no outreach or prospecting funnel; there is still no in-call value-flow editor.
- **Practice mode is the documented entry point for a new advisor**, because it needs no credential and exercises the whole arc.
- **The README now states the Cloudflare Workers move and the self-hosting warning together.** Off OpenAI Sites there is no injected identity header, so without Cloudflare Access every visitor is the single local advisor.
- **`INTEGRATIONS.md` and `public/docs/integrations.md` are byte-identical by intent**, and each now says so, so a future edit updates both.

### Files or behavior changed

- Rewritten: `README.md` (capability truth table updated row by row, Practice mode section added, Cloudflare hosting section replacing the Sites-portability section, transcript architecture section added, identity-mode table added, configuration table extended with `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `OPENAI_TRANSCRIPT_MODEL`, API surface extended to the 25 committed routes).
- Rewritten: `DEVELOPER_HANDOFF.md`. Its "Still open" item 1, "transcript synthesis is deterministic, not model-assisted", was fixed and removed. Its "Deliberately constrained" entry "improvement is never inferred" was wrong and became "direction inference never overrides a human". Its stale verification header (a 2026-07-26 pass, 25 backend tests) was replaced with an honest statement that this handoff was written from source reading. The outstanding list is now: the in-call flow editor, DOCX/PDF, the missing adapters, the absent funnel, single-advisor Google credentials, advisor-asserted screen-share safety, the two different practice-id prefix tests, the stale Step 6a in `docs/DEPLOYMENT.md`, the remote Google Fonts import, and Fireflies being unverified live.
- Updated: `public/docs/current-state.md`, `public/docs/architecture.md` (its "Current Build Boundary" section listed eight limitations, seven of which are fixed), `public/docs/integrations.md` and `INTEGRATIONS.md` (status header, the connector-first framing in section 1, the environment-variable table, and the integration matrix now separate implemented adapters from connector-only lanes).
- `public/docs/index.json`: descriptions refreshed; shape, ids, filenames and URLs unchanged, since `app/api/documents/route.ts` imports it as the static manifest.
- No source, test, config, or wiki file was modified.

### Tests and live verification performed

- **None.** This session was documentation-only and was explicitly instructed not to run `npm run build` or `npm test` while other agents were working in parallel.
- Verification was by source reading: `package.json` and all five test files (42 checks: 15 + 11 + 7 + 7 backend, 2 rendered-frontend, after a production build); `lib/auth.ts` and `lib/access-jwt.ts`; `lib/openai-transcript.ts` and `lib/openai-transcript-schema.ts`; `lib/metric-direction.ts`; `lib/demo.ts` and `app/api/demo/route.ts`; `lib/transcript-files.ts`; `lib/store.ts` and `db/schema.ts`; `lib/actions.ts`; `lib/deliverables.ts`; `lib/integrations/**`; `app/api/**` (all 25 committed routes confirmed to use `requirePrincipalAsync`); and the coaching layer in `app/components/AdvisorCockpit.tsx`.
- Untracked work in progress by other agents (a `.github/` directory, `app/api/health/route.ts`, `app/error.tsx`, `NEXT_STEPS.md`) was deliberately left undocumented, because it is not committed and may still change.

### Failures or limitations that remain

- No in-call value-flow editor; `flowConfirmations` reach the generated documents but are never rendered in the cockpit.
- No native DOCX or PDF generator; Markdown plus printable HTML, with Google Docs conversion or print-to-PDF as the route to a formal document.
- Gmail has no adapter; Apollo and PandaDoc remain connector-first; Exa and Firecrawl are not implemented; there is no outreach or prospecting funnel.
- `GOOGLE_REFRESH_TOKEN` is a single environment variable, so approved Google writes act as one identity no matter which advisor approved them.
- Screen-share protection depends on the advisor pressing Escape or tapping the toggle before sharing; the app cannot detect a share.
- `docs/DEPLOYMENT.md` Step 6a still tells the reader to migrate the API routes to the async resolver, which is already done. That file is owned elsewhere and was not edited.
- `app/globals.css` still imports Google Fonts from a remote stylesheet.
- Fireflies has never been verified against a live workspace.

### Production deployment identity

Not deployed as part of this change. The app has not yet been deployed to Cloudflare Workers; `wrangler.jsonc` and `docs/DEPLOYMENT.md` exist, and `.wrangler/` contains local development state only. Before exposing the app beyond a single advisor, set `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `REQUIRE_ADVISOR_AUTH=1`, set `LEGACY_OWNER_EMAIL` to the real advisor address before the first boot that adds `owner_id`, and turn `workers_dev` off once the app is served from an owned domain.

### Next uncompleted milestone

An in-call editor for value-flow steps that writes corrections back with `client-stated` provenance, and a real Cloudflare Workers deployment behind verified Access.

## 2026-07-26 — Gap closure: research-driven workflow, canonical Canvas, tenancy, real external writes

### Source or request

Repository owner asked for the known gaps to be filled so the app is usable as a production tool. Work was branched to `claude/repo-overview-b7tlrs` and divided across parallel agents by file ownership.

### Durable decisions

- **One canonical Canvas.** `lib/canvas.ts` is the only place a Canvas is built or merged. Research writes it, client evidence corrects it, and a corrected research claim is superseded rather than deleted. `"Key Partnerships"` normalizes to `"Key Partners"`.
- **Research proposes, it never confirms.** `valueFlow` and `discoveryQuestions` are part of the research contract. Any step or question whose source URL cannot be verified is kept as a proposal and downgraded to `gap`. Research output can never be `client-stated` or `doc`.
- **A delta is refused rather than estimated.** `computeMetricDelta` requires two client-confirmed readings in the same unit and period, or it records an explicit blocked reason.
- **Improvement is declared, never inferred.** Arithmetic direction is `increased`/`decreased`; `interpretation` stays `not-interpreted` unless the advisor states `improvedWhen`. This was found by testing: a turnaround improving from 3 days to 1 day was being reported as "worsened" into client-facing documents.
- **Approval and execution stay two decisions.** Adapters never decide whether they may act. An unconfigured provider makes no network call and leaves the intent approved so it can be retried once credentials exist.
- **Tenancy is enforced in SQL, not in application filtering.** A row belonging to another advisor is indistinguishable from a missing row.

### Files or behavior changed

- New: `lib/canvas.ts`, `lib/auth.ts`, `lib/transcript-files.ts`, `lib/integrations/` (7 files), `drizzle/0001_tenancy.sql`, `tests/gap-closure.test.mjs`.
- Rewritten or substantially extended: `lib/workflow.ts`, `lib/actions.ts`, `lib/store.ts`, `lib/research.ts`, `lib/openai-research.ts`, `lib/openai-research-schema.ts`, `lib/transcript.ts`, `lib/deliverables.ts`, `db/schema.ts`, `app/components/AdvisorCockpit.tsx`, `app/globals.css`.
- All 21 API routes now require an advisor principal. New routes: `/api/me`, `/api/intents`, `/api/intents/:id`, and per-engagement `/sprint`, `/outcome`, `/catalog`, `/publish`. `/api/documents/:id?format=html` returns printable HTML.
- Removed from the frontend: the six hardcoded flow strings, the `callTopics` demo script, the synthetic `Transcript file selected:` line, and the hardcoded integration status table.

### Tests and live verification performed

- `npm run lint` clean; `npx tsc --noEmit` clean; `npm run build` succeeds.
- 2 rendered-frontend tests and 26 backend tests pass, including a divergence check that two dissimilar companies produce materially different value flows and discovery questions.
- Against a running dev server on an explicit strict port: intake, research, `.vtt` file upload, Canvas-commit approval, call 2, diagnosis approval, deliverable generation, sprint activation, outcome measurement, and catalog write-back all completed.
- Tenant isolation verified: a second identity received `Engagement not found` and an empty list while the owner still saw the record.
- Intent gating verified: execution before approval was refused; after approval an unconfigured provider returned `not-configured` and performed no network call.
- Browser verification: the app loads with no runtime errors, the Integration Center renders live server status, and all four Operate screens mount.

### Failures or limitations that remain

- Transcript synthesis is deterministic, not model-assisted.
- No native DOCX or PDF generator; Markdown plus printable HTML, with Google Docs conversion as the route to a formal document.
- Gmail has no adapter; Apollo and PandaDoc remain connector-first; Exa and Firecrawl are not implemented.
- Google Fonts is loaded from a remote stylesheet, so type falls back where outbound access is blocked.

### Production deployment identity

Not deployed as part of this change. Before exposing the app beyond a single advisor, set `REQUIRE_ADVISOR_AUTH=1` and set `LEGACY_OWNER_EMAIL` to the real advisor address so pre-tenancy rows are claimed correctly.

### Next uncompleted milestone

Give the advisor an in-call editor for value-flow steps that writes corrections back with `client-stated` provenance.

## 2026-07-25 — Current-state audit and documentation handoff

### Source

Founder review of a real Tier 4 Advisors research run, followed by a repository and browser audit.

### Confirmed behavior

- OpenAI Responses API research is live and source-backed.
- The on-screen Business Model Canvas reflects real retrieved company information.
- The Flow of Work visualization is the same fixed six-step scaffold for every engagement.
- Research-tab questions combine model-produced hypothesis fields with generic frontend wording.
- The guided client call uses the original static six-topic demo script.
- The Pre-Call Readiness Brief and both recording-consent gates follow the approved workflow.
- Pasted transcript processing works through deterministic parsing and constraint-keyword rules.
- The file-upload path records only the selected filename.
- Fireflies import exists but is not configured locally.
- The generated Audit Report reads a canonical Canvas field that research does not populate.
- Google Sheets, Google Docs, email, and PandaDoc remain reviewed intents or documented future adapters.
- The app has no application-level tenant ownership.

### Research-provider decision

- Keep OpenAI web search as the current primary provider.
- Add Exa later as a measured fallback for weak company/source coverage.
- Use Firecrawl only for targeted crawling or JavaScript-rendering failures.
- Do not assume any provider returns better information every time; evaluate on a fixed company corpus.

### Documentation changes

- Replaced the minimal README with a detailed current-state, setup, architecture, governance, and portability guide.
- Added `DEVELOPER_HANDOFF.md` with exact implementation priorities and file-level risks.
- Updated the canonical workflow with value-flow and discovery-plan requirements plus an implementation delta.
- Updated stale architecture language that described the UI as unbuilt.
- Created an OpenWiki-compatible repository wiki and agent entrypoints.

### Verification before documentation changes

```text
eslint: pass
TypeScript: pass
vinext production build: pass
rendered frontend tests: 2 pass
backend workflow tests: 15 pass
```

### Next engineering milestone

Add `valueFlow` and `discoveryQuestions` to the research contract, persist one canonical Canvas, bind the research and client-call interfaces to those objects, and prove two companies produce different flows and questions.

## 2026-07-24 — OpenAI web research production release

### Shipped

- Added OpenAI Responses API web research with `store: false`.
- Added strict structured research parsing and source-backed fact filtering.
- Mapped retained facts to Business Model Canvas blocks.
- Preserved deterministic website research as the no-key and provider-failure fallback.
- Added dynamic OpenAI integration status.
- Normalized bare-domain website input.
- Corrected Business Model Canvas visual geometry.
- Added and refined the client-facing Pre-Call Readiness Brief and recording-consent gates.

### Verification

- Local live research smoke test retained multiple sources, facts, Canvas blocks, hypotheses, and gaps.
- Full automated suite passed.
- Deployed to OpenAI Sites as version 6.

### Production identity

- URL: `https://tier4-advisor-cockpit.mattrob333.chatgpt.site`
- Commit: `11c0fd34c796dd09ae31e11fb70cec5f23c045bc`
- Access at release: owner-only

## Logging convention for future agents

Append a dated entry containing:

1. source or request;
2. durable decisions;
3. files or behavior changed;
4. tests and live verification performed;
5. failures or limitations that remain;
6. production deployment identity when applicable;
7. the next uncompleted milestone.

Never record API keys, OAuth tokens, transcript contents, or private client data in this file.
