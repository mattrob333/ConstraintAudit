import { reviewIntent } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import { getIntent } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

async function intentId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!id) throw new HttpError(400, "Intent id is required.");
  return id;
}

export async function GET(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const intent = await getIntent(await intentId(context), principal.ownerId);
    if (!intent) throw new Error("Intent not found");
    return { intent };
  });
}

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await intentId(context);
    const input = await readJson<{ action?: "approve" | "reject" | "execute" }>(request);
    if (!input.action || !["approve", "reject", "execute"].includes(input.action)) {
      throw new HttpError(400, "action must be approve, reject, or execute.");
    }
    return reviewIntent(id, principal, input.action);
  });
}
