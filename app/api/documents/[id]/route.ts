import { engagementId, route } from "@/lib/http";
import { getArtifact } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const document = await getArtifact(await engagementId(context));
    if (!document) throw new Error("Document not found");
    return { document };
  });
}
