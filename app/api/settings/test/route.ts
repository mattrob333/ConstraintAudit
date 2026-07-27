import { requirePrincipalAsync } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import { getSettings, parseSpreadsheetId } from "@/lib/settings";
import { verifyProvider, type VerifiableProvider } from "@/lib/integrations/verify";

export const dynamic = "force-dynamic";

const VERIFIABLE_PROVIDERS: readonly VerifiableProvider[] = [
  "openai",
  "resend",
  "google_sheets",
  "google_docs",
  "fireflies",
];

function isVerifiable(value: unknown): value is VerifiableProvider {
  return typeof value === "string" && (VERIFIABLE_PROVIDERS as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const body = await readJson<{ provider?: unknown; spreadsheetId?: unknown }>(request);
    if (!isVerifiable(body.provider)) {
      throw new HttpError(400, `Unknown provider. Expected one of: ${VERIFIABLE_PROVIDERS.join(", ")}.`);
    }
    // google_sheets tests the advisor's BYO sheet: an explicit spreadsheetId in the body (URL or id)
    // wins, otherwise the saved setting is used. Other providers ignore opts.
    let opts: { spreadsheetId?: string; sheetTab?: string } | undefined;
    if (body.provider === "google_sheets") {
      const settings = await getSettings(principal.ownerId);
      const override = typeof body.spreadsheetId === "string" ? parseSpreadsheetId(body.spreadsheetId) : "";
      opts = {
        spreadsheetId: override || settings.crmSpreadsheetId,
        sheetTab: settings.crmSheetTab,
      };
    }
    return { result: await verifyProvider(body.provider, opts) };
  });
}
