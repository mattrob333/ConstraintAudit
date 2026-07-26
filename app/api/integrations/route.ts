import { env } from "cloudflare:workers";
import { advisorAuthMode, requirePrincipalAsync } from "@/lib/auth";
import { firefliesConfigured } from "@/lib/fireflies";
import { integrationRuntimeStatus } from "@/lib/integrations";
import { openAIResearchConfigured, openAIResearchModel } from "@/lib/openai-research";
import { route } from "@/lib/http";
import { ensureDatabase } from "@/lib/store";

export const dynamic = "force-dynamic";

const CRM_URL = "https://docs.google.com/spreadsheets/d/1ANLc7vhkhkJBtkvoeLDeuXJw4yIlCJcyz3j6B_69GX8";

function hasAll(...names: string[]): boolean {
  const bindings = env as unknown as Record<string, unknown>;
  return names.every((name) => typeof bindings[name] === "string" && String(bindings[name]).trim().length > 0);
}

export async function GET(request: Request) {
  return route(async () => {
    // Which providers are wired up is not public information: it describes the
    // deployment. Scope it to a signed-in advisor like every other route.
    await requirePrincipalAsync(request);
    await ensureDatabase();
    // The adapters decide whether they are configured. Reading that back here keeps
    // this screen from drifting away from what a write would actually do.
    const runtime = new Map(integrationRuntimeStatus().map((item) => [item.id, item]));
    const adapterReady = (id: string): boolean => runtime.get(id)?.configured ?? false;
    const authMode = advisorAuthMode();
    return {
      integrations: [
        {
          id: "d1",
          name: "Cloudflare D1",
          status: "connected",
          mode: "durable_persistence",
          storesSecrets: false,
        },
        {
          id: "public_research",
          name: "Public website research",
          status: "ready",
          mode: "deterministic_fetch_and_extract",
          storesSecrets: false,
        },
        {
          id: "fireflies",
          name: "Fireflies",
          status: firefliesConfigured() ? "configured" : "not_configured",
          mode: "server_side_import",
          setup: "Connect Fireflies securely; the browser never receives its credential.",
          environmentVariables: ["FIREFLIES_API_KEY"],
          storesSecrets: false,
        },
        {
          id: "apollo",
          name: "Apollo",
          status: hasAll("APOLLO_API_KEY") ? "configured_not_implemented" : "connector_first",
          mode: "credit_gated_research_intent",
          setup: "Use the Codex connector now. Any future direct adapter must disclose maximum credit cost before approval.",
          environmentVariables: ["APOLLO_API_KEY"],
          storesSecrets: false,
        },
        {
          id: "advisor_auth",
          name: "Advisor authentication",
          status: authMode === "cloudflare-access" ? "enforced"
            : authMode === "sites-headers" ? "enforced"
            : authMode === "denied" ? "misconfigured"
            : "single_advisor",
          mode: authMode,
          setup: authMode === "cloudflare-access"
            ? "Cloudflare Access is the identity provider. Every request must carry a signed Access JWT, which is verified against your team's public keys before an advisor is resolved."
            : authMode === "sites-headers"
              ? "Identity comes from the hosting layer's authenticated-user headers."
              : authMode === "denied"
                ? "Only one of CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD is set while advisor auth is required. Set both, or unset both, before deploying."
                : "Everyone is treated as one local advisor. Put Cloudflare Access in front and set CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD and REQUIRE_ADVISOR_AUTH=1 before more than one person uses this.",
          environmentVariables: [
            "REQUIRE_ADVISOR_AUTH", "LOCAL_ADVISOR_EMAIL",
            "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD",
          ],
          storesSecrets: false,
        },
        {
          id: "pandadoc",
          name: "PandaDoc",
          status: hasAll("PANDADOC_API_KEY") ? "configured_not_implemented" : "connector_first",
          mode: "reviewed_draft_then_separate_send",
          setup: "Use the Codex connector to create a draft. Sending always requires a second explicit approval.",
          environmentVariables: ["PANDADOC_API_KEY", "PANDADOC_TEMPLATE_UUID"],
          storesSecrets: false,
        },
        {
          id: "google_sheets",
          name: "Google Sheets CRM",
          status: adapterReady("google_sheets") ? "configured" : "intent_only",
          mode: "reviewed_write_back_intent",
          setup: "The app writes the row itself once the intent is explicitly approved and then executed. Without credentials it stops at the reviewed intent.",
          environmentVariables: [
            "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
            "GOOGLE_REFRESH_TOKEN", "GOOGLE_SHEETS_ID",
          ],
          resource: { name: "Tier 4 Engagement CRM", url: CRM_URL },
          storesSecrets: false,
        },
        {
          id: "google_drive_docs",
          name: "Google Drive / Docs",
          status: adapterReady("google_drive_docs") ? "configured" : "connector_first",
          mode: "approved_artifact_intent",
          setup: "An approved publication intent creates the Google Doc directly using the narrow drive.file scope.",
          environmentVariables: [
            "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
            "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_ROOT_FOLDER_ID",
          ],
          storesSecrets: false,
        },
        {
          id: "gmail",
          name: "Gmail",
          status: "intent_only",
          mode: "reviewed_send_intent",
          setup: "Approve the reviewed send intent in Codex; this runtime never sends directly.",
          environmentVariables: [
            "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_REFRESH_TOKEN",
          ],
          storesSecrets: false,
        },
        {
          id: "resend",
          name: "Resend",
          status: adapterReady("resend") ? "configured" : "not_configured",
          mode: "approved_intent_send_adapter",
          setup: "Sends the approved readiness brief. Sending requires an approved, idempotent intent and never happens automatically.",
          environmentVariables: ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO"],
          storesSecrets: false,
        },
        {
          id: "openai",
          name: "OpenAI web research",
          status: openAIResearchConfigured() ? "configured" : "not_configured",
          mode: "responses_api_web_search",
          setup: "The server uses the Responses API web-search tool. The browser never receives the credential.",
          environmentVariables: ["OPENAI_API_KEY", "OPENAI_RESEARCH_MODEL"],
          model: openAIResearchModel(),
          storesSecrets: false,
        },
      ],
    };
  });
}
