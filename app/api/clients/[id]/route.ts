import { linkClientToEngagement } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import { deleteClient, getClient, updateClient, type ClientPatch } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

async function clientId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!id) throw new HttpError(400, "Client id is required.");
  return id;
}

export async function GET(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const client = await getClient(await clientId(context), principal.ownerId);
    if (!client) throw new Error("Client not found");
    return { client };
  });
}

/**
 * Two commands, both explicit.
 *
 * `link_engagement` records that an audit was actually started from this roster row.
 * `update_fields` edits the roster entry itself. Neither can set `invited`: that status is
 * written by the server only after an audit invitation has really been sent, so it can never
 * be claimed by the browser.
 */
export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await clientId(context);
    const input = await readJson<{
      command?: "link_engagement" | "update_fields";
      engagementId?: string;
      fields?: ClientPatch;
    }>(request);
    if (input.command === "link_engagement") {
      if (!input.engagementId?.trim()) throw new HttpError(400, "engagementId is required.");
      return linkClientToEngagement(principal, id, input.engagementId.trim());
    }
    if (input.command !== "update_fields" || !input.fields || typeof input.fields !== "object") {
      throw new HttpError(400, "command must be link_engagement or update_fields with a fields object.");
    }
    const allowed = new Set([
      "company", "website", "contactName", "contactRole", "email", "industry", "headcountBand", "phone",
    ]);
    const keys = Object.keys(input.fields);
    if (!keys.length) throw new HttpError(400, "update_fields requires at least one field.");
    if (keys.some((key) => !allowed.has(key))) {
      throw new HttpError(400, "update_fields contains a server-owned field (status, invitedAt, and engagementId are not editable here).");
    }
    return { client: await updateClient(id, principal.ownerId, input.fields) };
  });
}

export async function DELETE(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const removed = await deleteClient(await clientId(context), principal.ownerId);
    if (!removed) throw new Error("Client not found");
    return { removed };
  });
}
