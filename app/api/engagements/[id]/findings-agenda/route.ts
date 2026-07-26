import { buildFindingsAgenda } from "@/lib/actions";
import { requirePrincipal } from "@/lib/auth";
import { engagementId, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = requirePrincipal(request);
    return buildFindingsAgenda(await engagementId(context), principal);
  }, { status: 201 });
}
