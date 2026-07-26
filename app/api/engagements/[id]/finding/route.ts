import { updateFinding } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    const input = await readJson<{
      humanOwner?: { name: string; role: string };
      baseline?: { name: string; value: string; unit: string; period: string; source: string };
      action?: "save" | "approve_diagnosis";
    }>(request);
    return updateFinding(id, principal, input);
  });
}
