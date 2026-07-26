import { requirePrincipalAsync } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { validatePublicUrl } from "@/lib/research";
import { createEngagement, listEngagements, type CreateEngagementInput } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    return { engagements: await listEngagements(principal.ownerId) };
  });
}

export async function POST(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const input = await readJson<CreateEngagementInput>(request);
    const website = input.website?.trim()
      ? validatePublicUrl(input.website).toString()
      : "";
    return {
      engagement: await createEngagement({
        ...input,
        website,
        advisor: input.advisor?.trim() || principal.displayName,
        ownerId: principal.ownerId,
      }),
    };
  }, { status: 201 });
}
