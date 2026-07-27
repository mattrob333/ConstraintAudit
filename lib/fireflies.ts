import { env } from "cloudflare:workers";
import type { Credentials } from "./secrets";
import type { TranscriptLine } from "./workflow";

const FIREFLIES_URL = "https://api.fireflies.ai/graphql";

interface FirefliesSentence {
  speaker_id?: string | number;
  speaker_name?: string;
  text?: string;
  raw_text?: string;
  start_time?: number;
  end_time?: number;
}

interface FirefliesTranscript {
  id: string;
  title?: string;
  transcript_url?: string;
  is_live?: boolean;
  sentences?: FirefliesSentence[];
}

/** With credentials the resolver owns precedence (server secret wins); without, env only. */
function apiKey(credentials?: Credentials): string {
  if (credentials) return credentials.get("FIREFLIES_API_KEY").trim();
  const bindings = env as unknown as Record<string, unknown>;
  return typeof bindings.FIREFLIES_API_KEY === "string" ? bindings.FIREFLIES_API_KEY.trim() : "";
}

export function firefliesConfigured(credentials?: Credentials): boolean {
  return apiKey(credentials).length > 0;
}

export async function fetchFirefliesTranscript(
  transcriptId: string,
  credentials?: Credentials,
): Promise<{
  id: string;
  title: string;
  transcriptUrl: string;
  rawText: string;
  auditRawText: string;
  retrievedAt: string;
  lines: TranscriptLine[];
}> {
  const key = apiKey(credentials);
  if (!key) throw new Error("Fireflies is not configured. Connect it securely before importing.");
  if (!transcriptId.trim()) throw new Error("transcriptId is required");
  const query = `query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id title transcript_url is_live
      sentences { speaker_id speaker_name text raw_text start_time end_time }
    }
  }`;
  const response = await fetch(FIREFLIES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query, variables: { transcriptId } }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json() as {
    data?: { transcript?: FirefliesTranscript };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok) throw new Error(`Fireflies returned HTTP ${response.status}.`);
  if (body.errors?.length) throw new Error(body.errors.map((item) => item.message || "Fireflies error").join("; "));
  const transcript = body.data?.transcript;
  if (!transcript) throw new Error("Fireflies transcript not found or not accessible.");
  if (transcript.is_live) {
    throw new Error("Fireflies transcript is still live. Wait for processing to finish before synthesis.");
  }
  const lines: TranscriptLine[] = (transcript.sentences ?? []).map((sentence) => {
    const seconds = Math.max(0, Math.floor(Number(sentence.start_time ?? 0)));
    return {
      speaker: sentence.speaker_name?.trim() || "Unknown speaker",
      timestamp: `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
      text: (sentence.text || sentence.raw_text || "").trim(),
      speakerConfidence: "unknown" as const,
      provenance: !sentence.speaker_name
        ? "gap" as const
        : /^(advisor|consultant|tier\s*4|facilitator)\b/i.test(sentence.speaker_name)
          ? "advisor-note" as const
          : "client-stated" as const,
    };
  }).filter((line) => line.text);
  return {
    id: transcript.id,
    title: transcript.title?.trim() || "Fireflies transcript",
    transcriptUrl: transcript.transcript_url ?? "",
    rawText: lines.map((line) => `[${line.timestamp}] ${line.speaker}: ${line.text}`).join("\n"),
    auditRawText: (transcript.sentences ?? [])
      .map((sentence) => sentence.raw_text?.trim())
      .filter(Boolean)
      .join("\n"),
    retrievedAt: new Date().toISOString(),
    lines,
  };
}
