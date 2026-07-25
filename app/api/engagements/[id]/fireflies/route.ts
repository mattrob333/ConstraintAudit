import { importFireflies } from "@/lib/actions";
import { engagementId, readJson, route } from "@/lib/http";
import type { ConsentAttestation } from "@/lib/workflow";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const id = await engagementId(context);
    const input = await readJson<{
      transcriptId: string;
      callNumber: 1 | 2;
      consentAttestation?: ConsentAttestation;
      speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
    }>(request);
    return importFireflies(id, input);
  }, { status: 201 });
}
