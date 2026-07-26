import { getDemoEngagement, removeDemoEngagement, seedDemoEngagement } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => getDemoEngagement(await requirePrincipalAsync(request)));
}

/**
 * Practice mode. Seeding is idempotent; `reset` rebuilds the worked example from scratch so
 * an advisor can rehearse the whole arc repeatedly without touching a real client record.
 */
export async function POST(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const input = await readJson<{ action?: "seed" | "reset" | "remove" }>(request);
    const action = input.action ?? "seed";
    if (action === "remove") return removeDemoEngagement(principal);
    if (action === "seed" || action === "reset") {
      return seedDemoEngagement(principal, action === "reset");
    }
    throw new HttpError(400, "action must be seed, reset, or remove.");
  }, { status: 201 });
}
