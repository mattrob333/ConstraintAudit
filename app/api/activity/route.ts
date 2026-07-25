import { route } from "@/lib/http";
import { listActivities } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const params = new URL(request.url).searchParams;
    const engagementId = params.get("engagementId") ?? undefined;
    const limit = Number(params.get("limit") ?? "100");
    return { activity: await listActivities(engagementId, Number.isFinite(limit) ? limit : 100) };
  });
}
