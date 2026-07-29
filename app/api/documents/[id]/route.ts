import { requirePrincipalAsync } from "@/lib/auth";
import { renderDeliverableDocument } from "@/lib/deliverables";
import { engagementId, jsonError, route } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { getArtifact, getEngagement } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

/**
 * The artifact's stored title is "{client} — {label}". The shell prints the client on its own
 * attribution line, so the heading keeps only the label. A title that does not carry the prefix is
 * returned untouched rather than guessed at.
 */
function documentLabel(title: string, client: string): string {
  const prefix = `${client.trim()} — `;
  return client.trim() && title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

export async function GET(request: Request, context: Context) {
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "html") {
    return route(async () => {
      const principal = await requirePrincipalAsync(request);
      const document = await getArtifact(await engagementId(context), principal.ownerId);
      if (!document) throw new Error("Document not found");
      return { document };
    });
  }
  // A printable, self-contained rendering of an artifact, inside the standard deliverable shell:
  // the advisor's letterhead, who it was prepared for, who prepared it, the date it was created,
  // and the confidentiality line at the foot of every page. This is what makes the generated
  // deliverables usable outside the app without adding a document provider.
  try {
    const principal = await requirePrincipalAsync(request);
    const document = await getArtifact(await engagementId(context), principal.ownerId);
    if (!document) throw new Error("Document not found");
    // The engagement supplies the client and the advisor of record. A missing engagement row is not
    // a reason to refuse the document — the shell falls back rather than breaking.
    const engagement = await getEngagement(String(document.engagement_id ?? ""), principal.ownerId);
    const settings = await getSettings(principal.ownerId);
    const client = engagement?.client ?? "";
    const html = renderDeliverableDocument(String(document.content), {
      client,
      title: documentLabel(String(document.title), client),
      advisor: engagement?.advisor ?? "",
      // The artifact's own creation date, never "now": reprinting a document must not re-date it.
      date: String(document.created_at ?? "").slice(0, 10),
      confidential: true,
      letterhead: settings.letterhead,
    });
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
