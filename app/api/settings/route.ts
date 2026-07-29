import { requirePrincipalAsync } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import { getSettings, putSettings, validateLogoDataUrl, type AdvisorSettings } from "@/lib/settings";

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
    // The logo is the only field an advisor can get wrong in a way worth explaining. Checking it
    // here means they get the plain reason ("that file is not a PNG or JPEG") with a 400, rather
    // than an upload that appears to save and silently does not.
    const logo = patch.letterhead?.logoDataUrl;
    if (logo !== undefined) {
      const checked = validateLogoDataUrl(logo);
      if (!checked.ok) throw new HttpError(400, checked.message);
    }
    return { settings: await putSettings(principal.ownerId, patch) };
  });
}
