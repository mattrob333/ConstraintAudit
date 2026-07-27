import { requirePrincipalAsync } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { getSettings, putSettings, type AdvisorSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    return { settings: await getSettings(principal.ownerId) };
  });
}

export async function PUT(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const patch = await readJson<Partial<AdvisorSettings>>(request);
    return { settings: await putSettings(principal.ownerId, patch) };
  });
}
