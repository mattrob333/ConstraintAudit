import { measureOutcome } from "@/lib/actions";
import { requirePrincipal } from "@/lib/auth";
import { engagementId, readJson, route } from "@/lib/http";
import type { BaselineMetric } from "@/lib/workflow";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return route(async () => {
    const principal = requirePrincipal(request);
    const id = await engagementId(context);
    const input = await readJson<{
      endingMetric: BaselineMetric;
      improvedWhen?: "higher" | "lower";
      constraintMoved?: boolean;
      nextConstraintObserved?: string;
      evidence?: Array<{ quote: string; source: string }>;
    }>(request);
    return measureOutcome(id, principal, input);
  }, { status: 201 });
}
