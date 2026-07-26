/**
 * Transcript file decoding for the Cloudflare Workers runtime.
 *
 * Web APIs only (atob / Uint8Array / TextDecoder / DecompressionStream): no Node
 * built-ins, no npm dependencies. Output is always plain transcript text shaped
 * `[MM:SS] Speaker: text` so `parseTranscriptText` in ./transcript can consume it,
 * and lines whose speaker is genuinely unknown are emitted as `Unknown speaker`
 * so they stay gaps instead of silently becoming client evidence.
 */

export type TranscriptFileInput = {
  name: string;
  mimeType?: string;
  content: string;
  encoding: "utf8" | "base64";
};

export type TranscriptFormat = "txt" | "vtt" | "srt" | "docx" | "json" | "unknown";

/** Hard ceiling on decoded bytes. Transcripts are text; anything larger is not one. */
const MAX_DECODED_BYTES = 2 * 1024 * 1024;

const UNKNOWN_SPEAKER = "Unknown speaker";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function detectTranscriptFormat(name: string, mimeType?: string): TranscriptFormat {
  const cleanName = (name ?? "").trim().toLowerCase();
  const extension = cleanName.includes(".") ? cleanName.slice(cleanName.lastIndexOf(".") + 1) : "";
  if (extension === "vtt" || extension === "webvtt") return "vtt";
  if (extension === "srt") return "srt";
  if (extension === "docx") return "docx";
  if (extension === "json") return "json";
  if (extension === "txt" || extension === "text" || extension === "md" || extension === "log") return "txt";

  const mime = (mimeType ?? "").trim().toLowerCase().split(";")[0];
  if (!mime) return "unknown";
  if (mime === "text/vtt" || mime === "text/webvtt") return "vtt";
  if (mime === "application/x-subrip" || mime === "text/srt" || mime === "application/x-srt") return "srt";
  if (mime === DOCX_MIME) return "docx";
  if (mime === "application/json" || mime === "text/json") return "json";
  if (mime === "text/plain" || mime === "text/markdown") return "txt";
  return "unknown";
}

export async function decodeTranscriptFile(
  input: TranscriptFileInput,
): Promise<{ text: string; format: string; warnings: string[] }> {
  const warnings: string[] = [];
  const name = (input?.name ?? "").trim() || "transcript file";
  const raw = typeof input?.content === "string" ? input.content : "";
  if (!raw.trim()) throw new Error(`${name} is empty; there is no transcript content to read.`);

  const detected = detectTranscriptFormat(input.name ?? "", input.mimeType);
  const base64 = input.encoding === "base64";

  if (!base64 && raw.length > MAX_DECODED_BYTES) {
    throw new Error(`${name} exceeds the ${MAX_DECODED_BYTES / (1024 * 1024)} MB transcript limit.`);
  }

  let bytes: Uint8Array | null = null;
  if (base64) {
    bytes = base64ToBytes(raw, name);
    if (bytes.length > MAX_DECODED_BYTES) {
      throw new Error(`${name} decodes to ${bytes.length} bytes, over the ${MAX_DECODED_BYTES} byte transcript limit.`);
    }
  }

  // A .docx is binary; it can only arrive as base64.
  const looksZipped = bytes !== null && bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (detected === "docx" || (detected === "unknown" && looksZipped)) {
    if (!bytes) {
      throw new Error(`${name} is a Word document and must be supplied as base64, not UTF-8 text.`);
    }
    if (!looksZipped) throw new Error(`${name} is not a readable .docx archive (missing ZIP signature).`);
    const text = await docxToTranscriptText(bytes);
    return finish(text, "docx", warnings, name);
  }

  const decoded = bytes ? decodeUtf8(bytes) : stripBom(raw);
  const normalized = normalizeNewlines(decoded);
  if (!normalized.trim()) throw new Error(`${name} contained no readable text.`);

  const sniffed = sniffTextFormat(normalized);
  let format: TranscriptFormat = detected;
  if (detected === "unknown") {
    format = sniffed ?? "txt";
    warnings.push(
      `Unrecognized file type for ${name}; read as ${format === "txt" ? "plain text" : format.toUpperCase()}.`,
    );
  } else if ((sniffed === "vtt" || sniffed === "srt") && sniffed !== detected) {
    // A recognized extension is only overridden by a certain sniff: a WEBVTT header or an
    // SRT index+arrow block. A leading "[" is a timestamped transcript far more often than JSON.
    format = sniffed;
    warnings.push(`${name} is named as ${detected.toUpperCase()} but contains ${sniffed.toUpperCase()} content.`);
  }

  if (format === "vtt") return finish(vttToTranscriptText(normalized), "vtt", warnings, name);
  if (format === "srt") return finish(srtToTranscriptText(normalized), "srt", warnings, name);
  if (format === "json") return finish(jsonToTranscriptText(normalized, name, warnings), "json", warnings, name);
  return finish(normalized.trim(), "txt", warnings, name);
}

function finish(
  text: string,
  format: string,
  warnings: string[],
  name: string,
): { text: string; format: string; warnings: string[] } {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${name} produced no transcript lines after decoding.`);
  if (!hasSpeakerLabels(trimmed)) {
    warnings.push("No speaker labels found; every line is Unknown speaker until an advisor maps the speakers.");
  }
  return { text: trimmed, format, warnings };
}

function hasSpeakerLabels(text: string): boolean {
  return text.split("\n").some((line) => {
    const matched = line.trim().match(/^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?([^:]{1,80}):\s*\S/);
    if (!matched) return false;
    const speaker = matched[1].trim();
    return Boolean(speaker) && !/^unknown\b/i.test(speaker);
  });
}

function sniffTextFormat(text: string): TranscriptFormat | null {
  const head = text.slice(0, 4096);
  if (/^﻿?\s*WEBVTT\b/.test(head)) return "vtt";
  if (/^\s*\d+\s*\n\s*\d{1,3}:\d{2}:\d{2},\d{1,3}\s*-->/m.test(head)) return "srt";
  // A leading bracket is not evidence of JSON: `[00:10] Speaker: text` is the most common
  // transcript shape there is. Only real, transcript-shaped JSON counts.
  if (!/^\s*[[{]/.test(head)) return null;
  try {
    return findSegments(JSON.parse(text)) ? "json" : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ bytes */

function base64ToBytes(value: string, name: string): Uint8Array {
  const cleaned = value
    .replace(/^data:[^,]*,/, "")
    .replace(/[\s\r\n]+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = cleaned.length % 4 === 0 ? cleaned : cleaned + "=".repeat(4 - (cleaned.length % 4));
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(`${name} is not valid base64 and could not be decoded.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  return stripBom(new TextDecoder("utf-8").decode(bytes));
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/* -------------------------------------------------------------- cue formats */

type Cue = { seconds: number; speaker: string; text: string };

function timeLabel(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(hours > 0 ? minutes : Math.floor(total / 60)).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

function cueStartSeconds(timingLine: string): number | null {
  const before = timingLine.split("-->")[0];
  const matched = before.match(/(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?[.,](\d{1,3})/);
  if (!matched) return null;
  const a = Number(matched[1]);
  const b = Number(matched[2]);
  const c = matched[3] === undefined ? null : Number(matched[3]);
  // `HH:MM:SS.mmm` when three groups are present, otherwise `MM:SS.mmm`.
  return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
}

function cleanSpeaker(value: string): string {
  const cleaned = value
    .replace(/[:<>]/g, " ")
    .replace(/^[-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned;
}

function looksLikeSpeaker(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || candidate.length > 60) return false;
  if (candidate.split(/\s+/).length > 5) return false;
  if (/[.!?,;]/.test(candidate)) return false;
  return /[A-Za-zÀ-ɏ]/.test(candidate);
}

function stripCueMarkup(line: string): string {
  return decodeXmlEntities(line.replace(/\{[^}]*\}/g, "").replace(/<[^>]*>/g, ""));
}

function closeCue(cue: Cue | null, cues: Cue[]): void {
  if (!cue) return;
  const text = cue.text.replace(/\s+/g, " ").trim();
  if (!text) return;
  if (!cue.speaker) {
    const matched = text.match(/^([^:]{1,60}):\s+(\S[\s\S]*)$/);
    if (matched && looksLikeSpeaker(matched[1])) {
      cue.speaker = cleanSpeaker(matched[1]);
      cue.text = matched[2].replace(/\s+/g, " ").trim();
      cues.push({ ...cue });
      return;
    }
  }
  cues.push({ ...cue, text });
}

/**
 * Shared WebVTT/SRT cue reader. Cue identifiers (VTT ids, SRT indexes) appear while
 * no cue is open and are discarded; everything after a timing line is payload.
 */
function parseCues(raw: string, honorVoiceTags: boolean): Cue[] {
  const cues: Cue[] = [];
  let current: Cue | null = null;
  let skippingBlock = false;
  for (const rawLine of normalizeNewlines(stripBom(raw)).split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      closeCue(current, cues);
      current = null;
      skippingBlock = false;
      continue;
    }
    if (skippingBlock) continue;
    if (/^WEBVTT\b/.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      skippingBlock = true;
      continue;
    }
    if (line.includes("-->")) {
      closeCue(current, cues);
      const seconds = cueStartSeconds(line);
      current = seconds === null ? null : { seconds, speaker: "", text: "" };
      continue;
    }
    if (!current) continue;
    if (honorVoiceTags && !current.speaker) {
      const voice = line.match(/<v(?:\.[^\s>]+)*\s+([^>]+)>/i);
      if (voice) current.speaker = cleanSpeaker(voice[1]);
    }
    const text = stripCueMarkup(line).replace(/^-\s+/, "").trim();
    if (!text) continue;
    current.text = current.text ? `${current.text} ${text}` : text;
  }
  closeCue(current, cues);
  return cues;
}

function cuesToTranscriptText(cues: Cue[]): string {
  return cues
    .map((cue) => `[${timeLabel(cue.seconds)}] ${cue.speaker || UNKNOWN_SPEAKER}: ${cue.text}`)
    .join("\n");
}

export function vttToTranscriptText(raw: string): string {
  return cuesToTranscriptText(parseCues(raw ?? "", true));
}

export function srtToTranscriptText(raw: string): string {
  return cuesToTranscriptText(parseCues(raw ?? "", false));
}

/* --------------------------------------------------------------------- json */

function jsonToTranscriptText(raw: string, name: string, warnings: string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
  const segments = findSegments(parsed);
  if (!segments) throw new Error(`${name} is JSON but contains no recognizable transcript segments.`);
  const lines: string[] = [];
  let sawTimestamp = false;
  for (const segment of segments) {
    if (typeof segment === "string") {
      if (segment.trim()) lines.push(`[00:00] ${UNKNOWN_SPEAKER}: ${segment.replace(/\s+/g, " ").trim()}`);
      continue;
    }
    if (!segment || typeof segment !== "object") continue;
    const record = segment as Record<string, unknown>;
    const text = firstString(record, ["text", "sentence", "content", "transcript", "value", "caption"]);
    if (!text) continue;
    const speaker = firstString(record, [
      "speaker",
      "speaker_name",
      "speakerName",
      "speaker_label",
      "speakerLabel",
      "name",
      "participant",
    ]);
    const seconds = firstNumber(record, ["start", "startTime", "start_time", "startSeconds", "offset", "timestamp"]);
    if (seconds !== null) sawTimestamp = true;
    lines.push(
      `[${timeLabel(seconds ?? 0)}] ${speaker ? cleanSpeaker(speaker) || UNKNOWN_SPEAKER : UNKNOWN_SPEAKER}: ${text
        .replace(/\s+/g, " ")
        .trim()}`,
    );
  }
  if (lines.length === 0) throw new Error(`${name} is JSON but contains no transcript text.`);
  if (!sawTimestamp) warnings.push("Transcript JSON carried no timestamps; every line is stamped 00:00.");
  return lines.join("\n");
}

function findSegments(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  for (const key of ["segments", "sentences", "transcript", "lines", "utterances", "monologues", "results", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = findSegments(value);
      if (nested) return nested;
    }
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  }
  return null;
}

/* --------------------------------------------------------------------- docx */

export async function docxToTranscriptText(bytes: Uint8Array): Promise<string> {
  if (!bytes || bytes.length < 22) throw new Error("The Word document is too small to be a valid .docx archive.");
  const documentXml = await readZipEntryText(bytes, "word/document.xml");
  return documentXmlToText(documentXml);
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function readZipEntryText(bytes: Uint8Array, entryName: string): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view, bytes.length);
  if (eocd < 0) throw new Error("The .docx archive is truncated: no ZIP end-of-central-directory record was found.");

  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset === 0xffffffff || entryCount === 0xffff) {
    throw new Error("ZIP64 .docx archives are not supported; re-save the document in a standard format.");
  }
  if (centralOffset >= bytes.length) throw new Error("The .docx central directory offset is outside the file.");

  let pointer = centralOffset;
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) {
      throw new Error("The .docx central directory is malformed.");
    }
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const uncompressedSize = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    if (name === entryName) {
      if (uncompressedSize > MAX_DECODED_BYTES) {
        throw new Error(`${entryName} is ${uncompressedSize} bytes, over the ${MAX_DECODED_BYTES} byte limit.`);
      }
      const data = await readLocalEntry(bytes, view, localOffset, method, compressedSize);
      return decoder.decode(data);
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`The .docx archive does not contain ${entryName}; it may not be a Word document.`);
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  const lowest = Math.max(0, length - (0xffff + 22));
  for (let offset = length - 22; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

async function readLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compressedSize: number,
): Promise<Uint8Array> {
  if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
    throw new Error("The .docx local file header is malformed.");
  }
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const end = start + compressedSize;
  if (end > bytes.length) throw new Error("The .docx archive is truncated inside word/document.xml.");
  const payload = bytes.subarray(start, end);
  if (method === 0) return payload;
  if (method !== 8) throw new Error(`The .docx uses unsupported ZIP compression method ${method}.`);
  return inflateRaw(payload);
}

async function inflateRaw(payload: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This runtime cannot inflate .docx content (DecompressionStream is unavailable).");
  }
  // Copy so the stream owns a plain ArrayBuffer-backed view of the compressed entry.
  const input = new Uint8Array(payload);
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_DECODED_BYTES) {
        throw new Error(`The .docx expands past the ${MAX_DECODED_BYTES} byte transcript limit.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    throw new Error(`The .docx content could not be inflated: ${(error as Error)?.message ?? "unknown error"}`);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** `<w:p>` is one line; `<w:tab/>` a space; `<w:br/>` a newline; `<w:t>` runs concatenate. */
function documentXmlToText(xml: string): string {
  const paragraphPattern = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  const tokenPattern =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab(?:\s[^>]*)?\/?>|<w:br(?:\s[^>]*)?\/?>|<w:cr(?:\s[^>]*)?\/?>/g;
  const lines: string[] = [];
  let paragraphMatch: RegExpExecArray | null;
  let sawParagraph = false;
  while ((paragraphMatch = paragraphPattern.exec(xml)) !== null) {
    sawParagraph = true;
    const body = (paragraphMatch[1] ?? "")
      // Property blocks carry <w:tab/> definitions that are not document content.
      .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, "")
      .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, "")
      .replace(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g, "");
    let buffer = "";
    let tokenMatch: RegExpExecArray | null;
    tokenPattern.lastIndex = 0;
    while ((tokenMatch = tokenPattern.exec(body)) !== null) {
      const token = tokenMatch[0];
      if (token.startsWith("<w:tab")) buffer += " ";
      else if (token.startsWith("<w:br") || token.startsWith("<w:cr")) buffer += "\n";
      else buffer += tokenMatch[1] ?? "";
    }
    for (const piece of decodeXmlEntities(buffer).split("\n")) {
      lines.push(piece.replace(/[ \t]+/g, " ").trim());
    }
  }
  if (!sawParagraph) throw new Error("word/document.xml contained no paragraphs; the .docx could not be read.");
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("The Word document contained no text.");
  return text;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => codePoint(parseInt(digits, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}
