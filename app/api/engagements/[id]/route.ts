import { engagementId, readJson, route } from "@/lib/http";
import { requirePatchCommand } from "@/lib/guards";
import { getEngagement, listActivities, listArtifacts, updateEngagement } from "@/lib/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return route(async () => {
    const id = await engagementId(context);
    const engagement = await getEngagement(id);
    if (!engagement) throw new Error("Engagement not found");
    const [documents, activity] = await Promise.all([listArtifacts(id), listActivities(id)]);
    return { engagement, documents, activity };
  });
}

export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const id = await engagementId(context);
    const command = requirePatchCommand(await readJson<unknown>(request));
    if (command.command === "update_metadata") {
      return {
        engagement: await updateEngagement(id, {
          ...command.fields,
          expectedVersion: command.expectedVersion,
        }),
      };
    }
    return {
      engagement: await updateEngagement(id, {
        workflowState: command.nextState,
        ...(command.nextAction ? { nextAction: command.nextAction } : {}),
        expectedVersion: command.expectedVersion,
      }),
    };
  });
}
