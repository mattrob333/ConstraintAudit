import { requirePrincipal } from "@/lib/auth";
import { renderMarkdownToHtml } from "@/lib/deliverables";
import { engagementId, jsonError, route } from "@/lib/http";
import { getArtifact } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "html") {
    return route(async () => {
      const principal = requirePrincipal(request);
      const document = await getArtifact(await engagementId(context), principal.ownerId);
      if (!document) throw new Error("Document not found");
      return { document };
    });
  }
  // A printable, self-contained rendering of an artifact. This is what makes the
  // generated deliverables usable outside the app without adding a document provider.
  try {
    const principal = requirePrincipal(request);
    const document = await getArtifact(await engagementId(context), principal.ownerId);
    if (!document) throw new Error("Document not found");
    const html = renderMarkdownToHtml(String(document.content), String(document.title));
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
