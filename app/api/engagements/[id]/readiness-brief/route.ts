import { readinessBriefAction } from "@/lib/actions";
import { engagementId, readJson, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const id = await engagementId(context);
    const input = await readJson<{
      action?: "generate" | "approve" | "send_intent";
      videoLink?: string;
      duration?: string;
    }>(request);
    return readinessBriefAction(id, input);
  });
}
