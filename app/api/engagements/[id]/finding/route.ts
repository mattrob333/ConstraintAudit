import { updateFinding } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    // Kept in step with the action itself so a new editable field cannot be silently dropped
    // between the browser and the validation that decides whether it may be accepted.
    const input = await readJson<Parameters<typeof updateFinding>[2]>(request);
    return updateFinding(id, principal, input);
  });
}
