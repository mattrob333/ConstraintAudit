import { createAuditInviteIntent, previewAuditInvite } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { HttpError, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

/** The message that WOULD be queued. Reads only — no intent is created by a preview. */
export async function GET(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const { id } = await context.params;
    if (!id) throw new HttpError(400, "Client id is required.");
    return previewAuditInvite(principal, id);
  });
}

/**
 * Queue an audit invitation for review. This creates a `pending_review` intent and nothing else:
 * no provider is contacted here, and the send happens only from the Reviewed actions screen after
 * an explicit approval. A client with no email address is refused by the guard, server-side.
 */
export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const { id } = await context.params;
    if (!id) throw new HttpError(400, "Client id is required.");
    return createAuditInviteIntent(principal, id);
  }, { status: 201 });
}
