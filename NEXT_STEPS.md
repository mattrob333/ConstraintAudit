# Next steps

Working list for picking this up. Ordered so the things that block everything else come first.

Last updated: 2026-07-27.

---

## 1. Do these first — nothing else is safe until they are done

### 1.1 Decide the hosting target

The app is a Cloudflare Worker already: D1 for storage, `cloudflare:workers` bindings, the Cloudflare Vite
plugin. Deploying to **Cloudflare Workers** is a config file and a command — `wrangler.jsonc` is written and
`docs/DEPLOYMENT.md` walks it end to end.

**Vercel would be a port, not a migration.** There is no D1 there and no `cloudflare:workers` runtime, so the
whole storage layer (`lib/store.ts`, `db/index.ts`) and every `env` read would have to be rewritten against
Postgres or similar. Only take that on if something else forces it.

### 1.2 Put Cloudflare Access in front before anyone else gets the URL

This is the one that matters. On OpenAI Sites, advisor identity came from the `oai-authenticated-user-email`
header that Sites injected. **Nothing injects that header anywhere else.** So on a plain Cloudflare deploy:

| Setting | What actually happens |
| --- | --- |
| `REQUIRE_ADVISOR_AUTH` unset | Every visitor is resolved to the same local advisor and can read every engagement |
| `REQUIRE_ADVISOR_AUTH=1`, no Access | Nobody can authenticate; every API route returns 401 |

The fix is Cloudflare Access (Zero Trust) in front of the Worker, authenticating your team against Google.
The app verifies the Access JWT's signature against your team's public keys — it does not trust the header,
because a header alone is spoofable by anyone who can reach the Worker directly.

Set together, never separately:

```
CF_ACCESS_TEAM_DOMAIN=<your-team>.cloudflareaccess.com
CF_ACCESS_AUD=<application audience tag>
REQUIRE_ADVISOR_AUTH=1
```

Access needs a hostname on a zone you control, so this needs a **custom domain** — it cannot protect a
`*.workers.dev` URL. Set `workers_dev: false` once the custom domain is live.

### 1.3 Set `LEGACY_OWNER_EMAIL` before the first deploy, not after

Tenancy adds an `owner_id` column. The first time that column is created, existing rows are backfilled to
whoever `LEGACY_OWNER_EMAIL` names, falling back to `LOCAL_ADVISOR_EMAIL`. **The backfill runs once.** Set it
to your real address before the first deploy or existing engagements get claimed by
`local-advisor@localhost` and need a manual SQL `UPDATE` to recover.

### 1.4 Run the smoke test after deploying

```
npm run smoke -- https://your-worker-url
```

It checks the health endpoint, that the app serves, and — most importantly — that `/api/engagements` refuses
an unauthenticated request. That is the exact failure mode where a deploy silently exposes every client
record.

---

## 2. API keys — what each one actually unlocks

Local: create `.env.local` beside `package.json` (gitignored, never committed).
Production: the same names via `wrangler secret put`.

| Key | Without it | With it |
| --- | --- | --- |
| **`OPENAI_API_KEY`** | Research is keyword extraction from the website; transcript synthesis is regex pattern matching | Source-cited web research, a reasoned value flow and discovery questions, and model-assisted transcript synthesis. **This is the one that makes the product what it claims to be.** |
| `FIREFLIES_API_KEY` | The advisor fetches the transcript from Zoom/Meet and pastes or uploads it | Transcripts import automatically |
| `RESEND_API_KEY` + `EMAIL_FROM` | The readiness brief stops at an approved intent and is never sent | The approved brief actually reaches the client |
| Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) + `GOOGLE_SHEETS_ID`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Deliverables stay in-app as Markdown and printable HTML; CRM write-back stops at an intent | Approved documents become Google Docs; the CRM row is written |
| `OPENAI_TRANSCRIPT_MODEL` | Falls back to `OPENAI_RESEARCH_MODEL` | Optional per-task model override |

**Practice mode needs none of these.** You can demo the entire arc to the team today.

Not worth setting yet: `APOLLO_API_KEY`, `PANDADOC_API_KEY` — no adapters exist, so the keys do nothing.

---

## 3. Decisions only you can make

- **Coaching visibility default.** In-call coaching currently defaults to *visible*. An advisor who screen
  shares without toggling will show it. Mitigated by a labelled toggle, an Escape panic key, and a heads-up
  on the consent gate — but it relies on discipline. Defaulting to hidden is a one-line change.
- **Call length.** The guided call currently generates around 15 questions. That is tight for 60 minutes,
  especially for an advisor still finding their feet. Options: trim the generated set, mark fewer as
  required, or let advisors skip ahead freely.
- **Proposal price.** `FIXED_SPRINT_PRICE_USD` in `lib/deliverables.ts` is $2,500. One constant, one place.
- **ROI.** The proposal states the fee but computes no return figure. That needs a client-confirmed baseline
  and a projected delta, and the app deliberately refuses to invent either. If you want a return number in
  the room it has to come from a number the client confirmed on call 1.

---

## 4. Not built yet

### Outreach funnel (the largest remaining piece)

Import an advisor's existing lead list, research each company, generate a draft that cites something real
about that specific business, let the advisor edit and approve, send, then promote a responder into a full
engagement carrying the research across. Modelled as a `prospect` record that lives before an engagement.

Sized for a real advisor's list, not bulk sending. Start reply detection as a manual "they replied" button;
Gmail polling is real work and is not the bottleneck at this volume.

### Per-advisor Google OAuth for *actions*

Cloudflare Access gives each advisor a verified Google identity for signing in. But Google *actions* — the
Doc, the Sheet row, the calendar invite — still run through one shared refresh token, so they come from one
account rather than the advisor the client met. Needs an OAuth callback, encrypted per-advisor token storage
in D1, and a "Connect Google" screen.

If you go this route, publish the OAuth app as **Internal** to your Workspace org. That skips Google's
verification review entirely. External apps requesting `gmail.send` (a restricted scope) need a third-party
security assessment.

### Smaller gaps

- No calendar invite or Meet link yet — meeting times are captured, but nothing writes to a calendar.
- No native DOCX or PDF export. Deliverables are Markdown plus printable HTML; Google Docs conversion is the
  route to a formal document.
- Gmail, Apollo and PandaDoc have no adapters. Resend is the only sender.
- No Exa or Firecrawl.
- `canvasRevision` and `researchQuality` are specified but unimplemented.
- No retention, deletion, or rate limiting.

---

## 5. Known rough edges

- **"What we heard" can come back thin.** The findings agenda only accepts quotes already tied to the
  finding, so on a short call that section can be sparse. On a real 45-minute call it fills out.
- **Model synthesis is unproven on real calls.** The grounding is tested — a fabricated quote is rejected,
  an advisor line can never become client evidence. What has *not* been tested is whether what survives
  grounding is genuinely useful on a real client transcript. Worth a dry run before relying on it live.
- **The first call adds latency.** Model-assisted synthesis adds roughly 10–30 seconds per transcript.
- **Local dev D1 accumulates test data.** `.wrangler/` holds the local SQLite file; delete it to reset.

---

## 6. How to demo this tomorrow

1. `npm install && npm run dev`
2. Open the app, click **Practice mode**
3. Walk the 15-stop tour — it navigates the real screens with a worked example (Meridian Millwork, a millwork
   shop whose quotes all wait on the owner: 9 days per quote, down to 3 after the sprint)
4. In the guided call, press **Escape** to show how coaching vanishes the instant you share your screen

No keys, no network, no client data. Identical every time, so two advisors see the same example.
