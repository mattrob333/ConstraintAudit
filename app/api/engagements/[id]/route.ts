import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";
import { requirePatchCommand } from "@/lib/guards";
import { getEngagement, listActivities, listArtifacts, listIntents, updateEngagement } from "@/lib/store";
import { normalizeFirmographics } from "@/lib/workflow";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
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
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    const command = requirePatchCommand(await readJson<unknown>(request));
    if (command.command === "update_metadata") {
      // Firmographics are optional engagement DATA, not a column, so they are lifted out of the
      // flat metadata fields and merged into `data` — where the shallow merge in the store keeps
      // every other stored key intact.
      const { firmographics, ...fields } = command.fields;
      return {
        engagement: await updateEngagement(id, {
          ...fields,
          ...(firmographics === undefined
            ? {}
            : { data: { firmographics: normalizeFirmographics(firmographics) } }),
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
