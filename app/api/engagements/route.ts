import { readJson, route } from "@/lib/http";
import { createEngagement, listEngagements, type CreateEngagementInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () => ({ engagements: await listEngagements() }));
}

export async function POST(request: Request) {
  return route(async () => {
    const input = await readJson<CreateEngagementInput>(request);
    return { engagement: await createEngagement(input) };
  }, { status: 201 });
}
