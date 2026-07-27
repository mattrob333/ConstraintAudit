import { requirePrincipalAsync } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { CRM_COLUMNS } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** A clearly-fake sample row (row 2) the advisor deletes after importing. Keyed by CRM column. */
const SAMPLE_ROW: Record<(typeof CRM_COLUMNS)[number], string> = {
  "Engagement ID": "eng_sample_0001",
  Client: "ACME Example Co (SAMPLE - delete this row)",
  Website: "https://example.com",
  "Primary Contact": "Jane Sample",
  Email: "jane@example.com",
  Advisor: "Tier 4 Advisor",
  Stage: "Client",
  Status: "Not started",
  "Next Action": "Research this business",
  "Due Date": "2026-01-31",
  "Last Contact": "",
  "Call 1": "",
  "Call 2": "",
  "Readiness Brief status": "Not drafted",
  "Baseline status": "Missing",
  "Engagement Folder": "",
  Notes: "Delete this sample row before importing your own engagements.",
};

/** RFC 4180 quoting: wrap in quotes and double any embedded quote when the cell needs it. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(",");
}

export async function GET(request: Request) {
  // A CSV download rather than JSON: same principal gate as every other route, non-JSON Response
  // like app/api/documents/[id]/route.ts's html path.
  try {
    await requirePrincipalAsync(request);
    const csv = [
      csvRow(CRM_COLUMNS),
      csvRow(CRM_COLUMNS.map((column) => SAMPLE_ROW[column])),
    ].join("\r\n") + "\r\n";
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="tier4-crm-template.csv"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
