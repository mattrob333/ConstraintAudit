# Tier 4 Advisor Cockpit Development Log

This is a durable, append-oriented log for implementation decisions, verification evidence, and handoffs. It is not a substitute for Git history or the canonical workflow specification.

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
