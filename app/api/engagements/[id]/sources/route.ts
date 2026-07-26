import { ingestSourceDocument } from "@/lib/actions";
import { requirePrincipal } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";
import type { TranscriptFileInput } from "@/lib/transcript-files";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = requirePrincipal(request);
    const id = await engagementId(context);
    const input = await readJson<{ file: TranscriptFileInput; label?: string }>(request);
    return ingestSourceDocument(id, principal, input);
  }, { status: 201 });
}
