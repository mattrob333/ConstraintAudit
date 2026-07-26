import { env } from "cloudflare:workers";
import { firefliesConfigured } from "@/lib/fireflies";
import { openAIResearchConfigured, openAIResearchModel } from "@/lib/openai-research";
import { route } from "@/lib/http";
import { ensureDatabase } from "@/lib/store";

export const dynamic = "force-dynamic";

const CRM_URL = "https://docs.google.com/spreadsheets/d/1ANLc7vhkhkJBtkvoeLDeuXJw4yIlCJcyz3j6B_69GX8";

function hasAll(...names: string[]): boolean {
  const bindings = env as unknown as Record<string, unknown>;
  return names.every((name) => typeof bindings[name] === "string" && String(bindings[name]).trim().length > 0);
}

export async function GET() {
  return route(async () => {
    await ensureDatabase();
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
          status: hasAll("REQUIRE_ADVISOR_AUTH") ? "enforced" : "single_advisor",
          mode: "sites_identity_headers_with_owner_scoping",
          setup: "Every record is scoped to the signed-in advisor. Set REQUIRE_ADVISOR_AUTH=1 to refuse unauthenticated requests before exposing the app to more than one advisor.",
          environmentVariables: ["REQUIRE_ADVISOR_AUTH", "LOCAL_ADVISOR_EMAIL"],
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
          status: hasAll("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_SHEETS_ID")
            ? "configured"
            : "intent_only",
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
          status: hasAll("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN")
            ? "configured"
            : "connector_first",
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
          status: hasAll("RESEND_API_KEY", "EMAIL_FROM") ? "configured" : "not_configured",
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
