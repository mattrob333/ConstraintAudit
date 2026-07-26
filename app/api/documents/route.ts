import { requirePrincipalAsync } from "@/lib/auth";
import { route } from "@/lib/http";
import { listArtifacts } from "@/lib/store";
import staticManifest from "@/public/docs/index.json";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const engagementId = new URL(request.url).searchParams.get("engagementId") ?? undefined;
    const generatedDocuments = await listArtifacts(principal.ownerId, engagementId);
    const staticDocuments = staticManifest.map((document) => ({
      ...document,
      source: "static",
      kind: "reference",
      status: "published",
    }));
    return {
      documents: [
        ...staticDocuments,
        ...generatedDocuments.map((document) => ({ ...document, source: "generated" })),
      ],
      staticDocuments,
      generatedDocuments,
    };
  });
}
