import { defaultDriveFolderId, extractErrorMessage, googleDriveConfigured, missingGoogleVars, readJsonBody } from "./env";
import { DRIVE_FILE_SCOPE, getAccessTokenResult } from "./google-oauth";
import type { AdapterResult, CreateDocumentInput, CreateDocumentData } from "./types";

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const PROVIDER = "google_docs";

interface DriveFile {
  id?: string;
  name?: string;
  webViewLink?: string;
  parents?: string[];
}

function fail(detail: string): AdapterResult<CreateDocumentData> {
  return { ok: false, status: "failed", provider: PROVIDER, detail };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline conversion runs on already-escaped text, so injected markup cannot survive. */
function inlineHtml(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Minimal, self-contained Markdown -> HTML conversion.
 *
 * lib/deliverables.ts owns the full renderer; this stays deliberately small so the
 * integration layer has no dependency on deliverable formatting.
 */
export function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inlineHtml(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listTag) {
      out.push(`</${listTag}>`);
      listTag = null;
    }
  };
  const openList = (tag: "ul" | "ol") => {
    if (listTag !== tag) {
      closeList();
      out.push(`<${tag}>`);
      listTag = tag;
    }
  };

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineHtml(heading[2].trim())}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeParagraph();
      closeList();
      out.push("<hr />");
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      openList("ul");
      out.push(`<li>${inlineHtml(bullet[1].trim())}</li>`);
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      closeParagraph();
      openList("ol");
      out.push(`<li>${inlineHtml(ordered[1].trim())}</li>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeParagraph();
      closeList();
      out.push(`<blockquote><p>${inlineHtml(quote[1].trim())}</p></blockquote>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  closeParagraph();
  closeList();
  return out.join("\n");
}

function htmlDocument(title: string, body: string): string {
  return [
    "<html>",
    `<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>`,
    `<body>${body}</body>`,
    "</html>",
  ].join("");
}

/** Hand-built multipart/related body: Drive converts the HTML part into a Doc. */
function multipartBody(boundary: string, metadata: unknown, html: string): string {
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/**
 * Create one Google Doc from approved content. Single attempt: a retry would risk
 * a duplicate artifact, so the caller re-invokes only after recording the failure.
 */
export async function createDocument(
  input: CreateDocumentInput,
): Promise<AdapterResult<CreateDocumentData>> {
  if (!googleDriveConfigured()) {
    return {
      ok: false,
      status: "not-configured",
      provider: PROVIDER,
      detail: `Google Drive is not configured. Missing: ${missingGoogleVars().join(", ")}.`,
    };
  }

  const title = input.title.trim();
  if (!title) return fail("A document title is required.");

  const html = input.html?.trim()
    ? input.html.trim()
    : markdownToHtml(input.markdown ?? "");
  if (!html) return fail("Refusing to create an empty document: supply `html` or `markdown`.");

  const token = await getAccessTokenResult([DRIVE_FILE_SCOPE]);
  if (!token.ok) {
    return {
      ok: false,
      status: token.reason === "not-configured" ? "not-configured" : "failed",
      provider: PROVIDER,
      detail: token.detail,
    };
  }

  const folderId = (input.folderId ?? defaultDriveFolderId()).trim();
  const metadata: Record<string, unknown> = { name: title, mimeType: GOOGLE_DOC_MIME };
  if (folderId) metadata.parents = [folderId];

  const boundary = `tier4-${crypto.randomUUID()}`;
  const url = `${DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent("id,name,webViewLink,parents")}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody(boundary, metadata, htmlDocument(title, html)),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return fail("Google Drive did not respond within 45s. The document may or may not have been created; verify before retrying.");
  }

  const body = await readJsonBody<DriveFile>(response);
  if (!response.ok) {
    const scopeNote = token.missingScopes.length
      ? ` The refresh token does not carry ${token.missingScopes.join(", ")}.`
      : "";
    return fail(`Google Drive returned HTTP ${response.status}: ${extractErrorMessage(body, "no error detail")}.${scopeNote}`);
  }

  const file = body.json;
  if (!file?.id) return fail("Google Drive accepted the upload but returned no file id.");

  const webViewLink = file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`;
  return {
    ok: true,
    status: "created",
    provider: PROVIDER,
    detail: folderId
      ? `Created Google Doc "${file.name || title}" in folder ${folderId}.`
      : `Created Google Doc "${file.name || title}" in the authorized account's Drive root.`,
    data: { id: file.id, name: file.name || title, webViewLink, folderId: folderId || undefined },
    externalUrl: webViewLink,
  };
}
