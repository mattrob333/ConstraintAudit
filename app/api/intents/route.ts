import { requirePrincipalAsync } from "@/lib/auth";
import { route } from "@/lib/http";
import { listIntents } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const engagementId = new URL(request.url).searchParams.get("engagementId") ?? undefined;
    return { intents: await listIntents(principal.ownerId, engagementId) };
  });
}
