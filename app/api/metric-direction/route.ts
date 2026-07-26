import { requirePrincipal } from "@/lib/auth";
import { route } from "@/lib/http";
import { resolveMetricDirection } from "@/lib/metric-direction";
import { CONSTRAINT_TYPES, isOneOf } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/**
 * Read-only preview of which way a metric has to move to count as an improvement.
 * The outcome form calls this while the advisor types, so the proposed reading is
 * visible and correctable before anything is recorded.
 */
export async function GET(request: Request) {
  return route(async () => {
    requirePrincipal(request);
    const params = new URL(request.url).searchParams;
    const constraintType = params.get("constraintType");
    return {
      inference: await resolveMetricDirection(
        {
          name: params.get("name") ?? "",
          value: "",
          unit: params.get("unit") ?? "",
          period: params.get("period") ?? "",
          source: "",
        },
        isOneOf(CONSTRAINT_TYPES, constraintType) ? { constraintType } : {},
      ),
    };
  });
}
