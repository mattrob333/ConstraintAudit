import { getD1 } from "@/db";
import { advisorAuthMode, advisorAuthRequired } from "@/lib/auth";
import { route } from "@/lib/http";
import { ensureDatabase } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * `GET /api/health` — uptime monitoring and post-deploy verification.
 *
 * **This is the one unauthenticated route in the app.** Every other route under `app/api/` calls
 * `requirePrincipalAsync`. This one deliberately does not, because it has to answer *before* you
 * know whether authentication is working — a health check that returns 401 when Access is
 * half-configured tells a monitor nothing about whether the Worker and its database are alive.
 *
 * Because it is unauthenticated it must be treated as world-readable, and it is: it returns only
 * booleans, an ISO timestamp, and the name of the identity mode. No environment variable values, no
 * secrets, no engagement or client data, no row counts, and no error text or stack traces from a
 * failed database call — a D1 error message can carry a binding name or SQL fragment, so the
 * failure is reported as a bare `reachable: false`.
 *
 * ## On publishing `advisorAuthMode()`
 *
 * Decision: **expose it, ungated.**
 *
 * It does reveal whether this deployment enforces authentication. But that fact is already trivially
 * observable by anyone with the URL: one unauthenticated `GET /api/engagements` distinguishes
 * "wide open" (200 with a list of engagements) from "enforced" (401) without this endpoint existing.
 * Withholding the mode here would hide it from the operator and the monitor, not from an attacker —
 * security through obscurity paid for entirely by the defender.
 *
 * Against that, the operational value is high and asymmetric. `local-fallback` on a public
 * deployment is the single worst failure mode this app has (see "The warning you must not skip" in
 * docs/DEPLOYMENT.md: every visitor silently becomes the same advisor and can read every
 * engagement), and `denied` means nobody can authenticate at all. Both are silent from the outside
 * unless something says so out loud. Publishing the mode lets `scripts/smoke.mjs` and an uptime
 * monitor alert on exactly those states.
 *
 * The mode *name* is published; the configuration behind it is not. `CF_ACCESS_TEAM_DOMAIN`,
 * `CF_ACCESS_AUD`, `LOCAL_ADVISOR_EMAIL` and every other binding value stay unexposed — those are
 * deployment-specific identifiers, and `/api/integrations` (which lists them, authenticated) is
 * where that detail belongs.
 */

/**
 * True when D1 answers right now.
 *
 * `ensureDatabase()` memoizes its success for the life of the isolate, so on its own it would stop
 * touching D1 after the first healthy request and report a stale `true` for a database that has
 * since gone away. (Failures are not memoized — it clears the cache and rethrows — so only the
 * success path goes stale.) The trailing `SELECT 1` is the actual liveness probe: it costs one
 * trivial query and makes the answer true at the time of asking, which is what a monitor needs.
 */
async function databaseReachable(): Promise<boolean> {
  try {
    await ensureDatabase();
    await getD1().prepare("SELECT 1").first();
    return true;
  } catch {
    // Swallowed on purpose: the reason is for the Worker's logs, not for a public response body.
    return false;
  }
}

export async function GET(): Promise<Response> {
  const reachable = await databaseReachable();
  const mode = advisorAuthMode();
  // 503 so an uptime monitor alerts on a Worker that is up but cannot reach its database.
  return route(
    async () => ({
      ok: reachable,
      timestamp: new Date().toISOString(),
      database: { reachable },
      auth: {
        mode,
        // `denied` is "configured to require auth but nothing can satisfy it", which is enforcement
        // in the sense that matters here: no request gets through unauthenticated.
        enforced: mode !== "local-fallback",
        required: advisorAuthRequired(),
      },
    }),
    { status: reachable ? 200 : 503 },
  );
}
