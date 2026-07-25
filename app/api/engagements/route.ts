import { readJson, route } from "@/lib/http";
import { validatePublicUrl } from "@/lib/research";
import { createEngagement, listEngagements, type CreateEngagementInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return route(async () => ({ engagements: await listEngagements() }));
}

export async function POST(request: Request) {
  return route(async () => {
    const input = await readJson<CreateEngagementInput>(request);
    const website = input.website?.trim()
      ? validatePublicUrl(input.website).toString()
      : "";
    return { engagement: await createEngagement({ ...input, website }) };
  }, { status: 201 });
}
