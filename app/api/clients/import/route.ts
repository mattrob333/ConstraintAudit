import { importClientsCsv } from "@/lib/actions";
import { requirePrincipalAsync } from "@/lib/auth";
import { readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * CSV import. The file is parsed here, on the server — the browser only reads the bytes, so the
 * header mapping, the size cap, the duplicate rule, and the skip reasons all have exactly one
 * implementation. Nothing external is contacted by an import.
 */
export async function POST(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const input = await readJson<{ fileName?: string; content?: string }>(request);
    return importClientsCsv(principal, input);
  });
}
