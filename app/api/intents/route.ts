import { requirePrincipalAsync } from "@/lib/auth";
import { route } from "@/lib/http";
import { listClientIntents, listIntents, type DbRow } from "@/lib/store";

export const dynamic = "force-dynamic";

function createdAt(row: DbRow): string {
  return typeof row.created_at === "string" ? row.created_at : "";
}

/**
 * Reviewed actions for one advisor.
 *
 * Intents live in two scopes. Most hang off an engagement; an audit invitation hangs off a
 * client-roster row, because the roster exists before any engagement does. Both belong in the
 * one review queue — an advisor should never have to remember which screen a pending external
 * write was proposed from — so a scoped request returns that engagement's intents plus every
 * roster-scoped intent, newest first. Ownership scoping is unchanged: both reads are bound to
 * the same principal.
 */
export async function GET(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const params = new URL(request.url).searchParams;
    const engagementId = params.get("engagementId") ?? undefined;
    const clientId = params.get("clientId") ?? undefined;
    if (clientId) {
      return { intents: await listClientIntents(principal.ownerId, clientId) };
    }
    if (!engagementId) {
      // Unscoped: listIntents already returns every intent this advisor owns, in both scopes.
      return { intents: await listIntents(principal.ownerId) };
    }
    const [engagementIntents, clientIntents] = await Promise.all([
      listIntents(principal.ownerId, engagementId),
      listClientIntents(principal.ownerId),
    ]);
    const intents = [...engagementIntents, ...clientIntents]
      .sort((a, b) => createdAt(b).localeCompare(createdAt(a)));
    return { intents };
  });
}
