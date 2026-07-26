import { requirePrincipal } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";
import { requirePatchCommand } from "@/lib/guards";
import { getEngagement, listActivities, listArtifacts, listIntents, updateEngagement } from "@/lib/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return route(async () => {
    const principal = requirePrincipal(request);
    const id = await engagementId(context);
    const engagement = await getEngagement(id, principal.ownerId);
    if (!engagement) throw new Error("Engagement not found");
    const [documents, activity, intents] = await Promise.all([
      listArtifacts(principal.ownerId, id),
      listActivities(principal.ownerId, id),
      listIntents(principal.ownerId, id),
    ]);
    return { engagement, documents, activity, intents };
  });
}

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const principal = requirePrincipal(request);
    const id = await engagementId(context);
    const command = requirePatchCommand(await readJson<unknown>(request));
    if (command.command === "update_metadata") {
      return {
        engagement: await updateEngagement(id, {
          ...command.fields,
          expectedVersion: command.expectedVersion,
        }, principal.ownerId),
      };
    }
    return {
      engagement: await updateEngagement(id, {
        workflowState: command.nextState,
        ...(command.nextAction ? { nextAction: command.nextAction } : {}),
        expectedVersion: command.expectedVersion,
      }, principal.ownerId),
    };
  });
}
