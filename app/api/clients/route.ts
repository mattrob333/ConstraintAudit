import { addClientManually, listClientRoster } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import type { ClientDraft } from "@/lib/clients";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    return listClientRoster(principal);
  });
}

export async function POST(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const input = await readJson<Partial<ClientDraft>>(request);
    return addClientManually(principal, input);
  }, { status: 201 });
}
