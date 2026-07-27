# scripts/

Operational scripts. No dependencies beyond Node 22 — nothing here needs `npm install` to have run.

## `smoke.mjs` — check a live deployment

Run this after every deploy, from a machine that is **not** signed in to the deployment (a private
browser session equivalent). It checks a real URL, not your local machine.

```bash
npm run smoke -- https://cockpit.example.com
# or, identically:
node scripts/smoke.mjs https://cockpit.example.com
```

Options:

| Option | Meaning |
| --- | --- |
| `--timeout <seconds>` | How long to wait for each request. Default 15. |
| `--help` | Usage. |

It runs four checks and prints a `PASS` / `WARN` / `FAIL` line for each:

1. **`/api/health`** — the app is up and its D1 database is reachable.
2. **`/`** — the home page loads (or Cloudflare Access shows its sign-in page, which is also correct).
3. **`/api/engagements` with no credentials** — the important one. An anonymous request must not be
   handed a list of engagements. If it is, the deployment is readable by anyone who has the URL, and
   the script says so loudly. See "The warning you must not skip" in `../docs/DEPLOYMENT.md`.
4. **`/api/integrations`** — reachable, and reports which integrations are configured when your
   credentials allow it (a 401 here is a pass: it means the endpoint is correctly protected).

Exit codes: `0` all checks passed, `1` at least one check failed, `2` the script could not run
(bad arguments).

A wrong URL, a non-JSON response, and a timeout are all reported as an ordinary failure line with a
plain-English explanation, not a stack trace.
