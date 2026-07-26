import { processTranscript } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";
import type { TranscriptFileInput } from "@/lib/transcript-files";
import type { ConsentAttestation } from "@/lib/workflow";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    const input = await readJson<{
      callNumber: 1 | 2;
      rawText?: string;
      file?: TranscriptFileInput;
      title?: string;
      sourceUrl?: string;
      humanOwner?: { name: string; role: string };
      speakerRoles?: Record<string, "client" | "advisor" | "unknown">;
      consentAttestation?: ConsentAttestation;
    }>(request);
    return processTranscript(id, principal, {
      ...input,
      source: input.file ? "upload" : "paste",
    });
  }, { status: 201 });
}
