import { correctOutcomeDirection, measureOutcome } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    const input = await readJson<Parameters<typeof measureOutcome>[2]>(request);
    return measureOutcome(id, principal, input);
  }, { status: 201 });
}

/**
 * Correct the improvement direction after the fact. The measured numbers do not
 * change; only how they are read, and the correction is recorded as the advisor's.
 */
export async function PATCH(request: Request, context: Context) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const id = await engagementId(context);
    const input = await readJson<{ improvedWhen: "higher" | "lower" }>(request);
    return correctOutcomeDirection(id, principal, input);
  });
}
