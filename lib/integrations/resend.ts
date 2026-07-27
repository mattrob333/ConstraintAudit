import { emailFrom, emailReplyTo, extractErrorMessage, missingResendVars, readJsonBody, resendApiKey, resendConfigured } from "./env";
import { markdownToHtml } from "./google-docs";
import type { AdapterResult, SendEmailData, SendEmailInput } from "./types";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const PROVIDER = "resend";

/** Resend caps a single send at 50 recipients. */
const MAX_RECIPIENTS = 50;

/** Direct HTTP clients must send a User-Agent; the official SDKs add one automatically. */
const USER_AGENT = "tier4-advisor-cockpit/1.0";

const EMAIL_PATTERN = /^[^\s@,<>]+@[^\s@,<>.]+\.[^\s@,<>]+$/;

interface ResendResponse {
  id?: string;
}

function fail(detail: string): AdapterResult<SendEmailData> {
  return { ok: false, status: "failed", provider: PROVIDER, detail };
}

/** Accepts a bare address or `Display Name <address>`. */
function senderLooksValid(from: string): boolean {
  const angle = /<([^>]+)>\s*$/.exec(from);
  return EMAIL_PATTERN.test((angle ? angle[1] : from).trim());
}

/**
 * Send one already-approved email.
 *
 * The adapter performs no retry: Resend dedupes on `Idempotency-Key` for 24 hours,
 * so a retry is the caller's decision and must reuse the same key.
 */
export async function sendEmail(input: SendEmailInput): Promise<AdapterResult<SendEmailData>> {
  const credentials = input.credentials;
  if (!resendConfigured(credentials)) {
    return {
      ok: false,
      status: "not-configured",
      provider: PROVIDER,
      detail: `Resend is not configured. Missing: ${missingResendVars(credentials).join(", ")}.`,
    };
  }

  const from = emailFrom(credentials);
  if (!senderLooksValid(from)) {
    return fail("EMAIL_FROM is not a usable sender. Use `Tier 4 <advisor@verified.example>` or a bare address on the verified domain.");
  }

  const recipients = (Array.isArray(input.to) ? [...input.to] : [input.to])
    .map((value) => value.trim())
    .filter(Boolean);
  if (!recipients.length) return fail("No recipient was supplied.");
  const invalid = recipients.filter((value) => !EMAIL_PATTERN.test(value));
  if (invalid.length) {
    return fail(`Refusing to send: ${invalid.length} recipient address(es) are malformed.`);
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return fail(`Refusing to send: ${recipients.length} recipients exceeds the Resend limit of ${MAX_RECIPIENTS}.`);
  }

  const subject = input.subject.trim();
  if (!subject) return fail("A subject line is required.");
  const text = input.markdownBody.trim();
  const html = input.htmlBody?.trim() || markdownToHtml(text);
  if (!text && !html) return fail("Refusing to send an empty email body.");

  const replyTo = emailReplyTo(credentials);
  const payload: Record<string, unknown> = { from, to: recipients, subject };
  if (text) payload.text = text;
  if (html) payload.html = html;
  if (replyTo) payload.reply_to = replyTo;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${resendApiKey(credentials)}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  const idempotencyKey = input.idempotencyKey?.trim();
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return fail("Resend did not respond within 15s. The message may or may not have been accepted; re-send only with the same idempotency key.");
  }

  const body = await readJsonBody<ResendResponse>(response);
  if (!response.ok) {
    return fail(`Resend returned HTTP ${response.status}: ${extractErrorMessage(body, "no error detail")}.`);
  }

  const id = typeof body.json?.id === "string" ? body.json.id : "";
  if (!id) return fail("Resend accepted the request but returned no email id.");

  return {
    ok: true,
    status: "sent",
    provider: PROVIDER,
    detail: `Sent to ${recipients.length} recipient(s). Resend email id ${id}.`,
    data: { id, to: recipients, idempotencyKey },
  };
}
