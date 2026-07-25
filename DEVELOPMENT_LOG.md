# Tier 4 Advisor Cockpit Development Log

This is a durable, append-oriented log for implementation decisions, verification evidence, and handoffs. It is not a substitute for Git history or the canonical workflow specification.

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
