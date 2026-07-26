import { activateSprint } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    const input = await readJson<{
      action?: "activate" | "update_task";
      taskId?: string;
      status?: "todo" | "in_progress" | "done";
    }>(request);
    return activateSprint(id, principal, input);
  }, { status: 201 });
}
