import { readinessBriefAction } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    const input = await readJson<{
      action?: "generate" | "approve" | "send_intent";
      videoLink?: string;
      duration?: string;
    }>(request);
    return readinessBriefAction(id, principal, input);
  });
}
