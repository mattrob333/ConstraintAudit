import { createDocumentPublishIntent } from "@/lib/actions";
import { requirePrincipal } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = requirePrincipal(request);
    const id = await engagementId(context);
    const input = await readJson<{ documentId: string }>(request);
    return createDocumentPublishIntent(id, principal, input);
  }, { status: 201 });
}
