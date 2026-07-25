import { generateDeliverables } from "@/lib/actions";
import { engagementId, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  return route(async () => generateDeliverables(await engagementId(context)), { status: 201 });
}
