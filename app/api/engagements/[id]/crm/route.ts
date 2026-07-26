import { createCrmWriteBackIntent } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    return createCrmWriteBackIntent(await engagementId(context), principal);
  }, { status: 201 });
}
