import { route } from "@/lib/http";
import { requirePrincipal } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route(async () => ({ principal: requirePrincipal(request) }));
}
