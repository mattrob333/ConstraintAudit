import { processTranscript } from "@/lib/actions";
import { engagementId, readJson, route } from "@/lib/http";
import type { ConsentAttestation } from "@/lib/workflow";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const id = await engagementId(context);
    const input = await readJson<{
      callNumber: 1 | 2;
      rawText: string;
      title?: string;
      sourceUrl?: string;
      humanOwner?: { name: string; role: string };
      speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
      consentAttestation?: ConsentAttestation;
    }>(request);
    return processTranscript(id, { ...input, source: "paste" });
  }, { status: 201 });
}
