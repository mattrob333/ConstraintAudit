import type {
  ConstraintHypothesis,
  ConstraintType,
  EvidenceClaim,
  ResearchSynthesis,
} from "./workflow";

const TYPE_SIGNALS: Array<{ type: ConstraintType; words: string[]; block: string }> = [
  { type: "capacity", words: ["capacity", "volume", "backlog", "scale", "busy"], block: "Key Resources" },
  { type: "latency", words: ["fast", "delivery", "turnaround", "schedule", "response"], block: "Key Activities" },
  { type: "quality", words: ["quality", "rework", "defect", "accuracy", "guarantee"], block: "Value Propositions" },
  { type: "knowledge", words: ["expert", "specialist", "experience", "custom", "consult"], block: "Key Resources" },
  { type: "policy", words: ["approval", "compliance", "policy", "certified", "regulated"], block: "Key Activities" },
];

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function compactText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function firstMatch(html: string, pattern: RegExp): string {
  return compactText(html.match(pattern)?.[1] ?? "");
}

export function normalizePublicUrlInput(input: string): string {
  const value = input.trim();
  if (!value) return "";
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

export function validatePublicUrl(input: string): URL {
  const url = new URL(normalizePublicUrlInput(input));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Research URL must be a public HTTP(S) URL without embedded credentials.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blockedNames = ["localhost", "localhost.localdomain", "metadata.google.internal"];
  if (
    blockedNames.includes(host) ||
    host.endsWith(".local") ||
    host.includes(":") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Research URL must resolve to a public website.");
  }
  return url;
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPublicIpv6(value: string): boolean {
  const address = value.toLowerCase();
  return !(
    address === "::" ||
    address === "::1" ||
    address.startsWith("::ffff:") ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^fe[89ab]/.test(address) ||
    address.startsWith("ff") ||
    address.startsWith("2001:db8:") ||
    address.startsWith("2001:10:")
  );
}

export async function assertPublicDns(
  url: URL,
  resolver: typeof fetch = fetch,
): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (!isPublicIpv4(hostname)) throw new Error("Research hostname resolves to a non-public address.");
    return;
  }
  if (hostname.includes(":")) throw new Error("Literal IPv6 research targets are not allowed.");
  const endpoint = "https://cloudflare-dns.com/dns-query";
  const resolve = async (type: "A" | "AAAA") => {
    const response = await resolver(
      `${endpoint}?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { Accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!response.ok) throw new Error("DNS resolution failed.");
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    return body.Answer ?? [];
  };
  const [ipv4, ipv6] = await Promise.all([resolve("A"), resolve("AAAA")]);
  const addresses = [...ipv4, ...ipv6]
    .filter((answer) => answer.type === 1 || answer.type === 28)
    .map((answer) => answer.data?.trim() ?? "")
    .filter(Boolean);
  if (addresses.length === 0) throw new Error("Research hostname has no public DNS address.");
  if (addresses.some((address) =>
    address.includes(":") ? !isPublicIpv6(address) : !isPublicIpv4(address)
  )) {
    throw new Error("Research hostname resolves to a non-public or unsupported address.");
  }
}

export async function readLimitedText(response: Response, maxBytes = 500_000): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Public website exceeds the research size limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Public website exceeds the research size limit.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

export function extractPublicPage(html: string): { title: string; description: string; text: string } {
  const sanitized = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");
  const title = firstMatch(sanitized, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    firstMatch(sanitized, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(sanitized, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const paragraphs = [...sanitized.matchAll(/<(?:h1|h2|p|li)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|p|li)>/gi)]
    .map((match) => compactText(match[1]))
    .filter((value) => value.length >= 20);
  return {
    title: title || "Untitled public website",
    description: description || paragraphs[0] || "",
    text: paragraphs.join(" ").slice(0, 24_000),
  };
}

export function synthesizeResearch(
  sourceUrl: string,
  page: { title: string; description: string; text: string } | null,
  client: string,
  now = new Date().toISOString(),
): ResearchSynthesis {
  const evidenceText = `${page?.title ?? ""} ${page?.description ?? ""} ${page?.text ?? ""}`.toLowerCase();
  const ranked = TYPE_SIGNALS.map((signal) => ({
    ...signal,
    score: signal.words.reduce((sum, word) => sum + (evidenceText.includes(word) ? 1 : 0), 0),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const facts: EvidenceClaim[] = [];
  if (page?.title) {
    facts.push({
      statement: `${client} public site title: ${page.title}`,
      provenance: "public-research",
      confidence: 0.95,
      sourceLabel: "Public website",
      sourceUrl,
    });
  }
  if (page?.description) {
    facts.push({
      statement: page.description.slice(0, 500),
      provenance: "public-research",
      confidence: 0.8,
      sourceLabel: "Public website description",
      sourceUrl,
    });
  }

  const constraintHypotheses: ConstraintHypothesis[] = ranked.map((signal) => ({
    canvasBlock: signal.block,
    type: signal.type,
    evidenceHint:
      signal.score > 0
        ? `Public language contains ${signal.words.filter((word) => evidenceText.includes(word)).join(", ")}.`
        : "No direct public evidence; this remains an advisor question, not a finding.",
    confirmationCondition: `Client evidence identifies a measurable ${signal.type} limit in the operating flow.`,
    killCondition: `Flow evidence shows ${signal.type} is not limiting throughput.`,
  }));

  return {
    sourceUrl,
    fetchedAt: now,
    fetchStatus: page ? "fetched" : "fallback",
    title: page?.title || `${client} research brief`,
    description:
      page?.description ||
      "The website could not be read. No company fact was inferred; confirm the operating model with the client.",
    facts,
    gaps: [
      "Monthly demand volume",
      "End-to-end cycle time",
      "Current queue size",
      "Error or rework rate",
      "Work declined, missed, or delayed",
      "Cost of delay or failure",
    ],
    constraintHypotheses,
  };
}

export async function researchPublicWebsite(
  sourceUrl: string,
  client: string,
  fetcher: typeof fetch = fetch,
  resolver: typeof fetch = fetch,
): Promise<ResearchSynthesis> {
  const initialUrl = validatePublicUrl(sourceUrl);
  let page: ReturnType<typeof extractPublicPage> | null = null;
  let finalUrl = initialUrl;
  try {
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertPublicDns(finalUrl, resolver);
      response = await fetcher(finalUrl, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 5) throw new Error("Public website exceeded the redirect limit.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Public website returned a redirect without a location.");
      finalUrl = validatePublicUrl(new URL(location, finalUrl).toString());
    }
    if (!response) throw new Error("Public website fetch did not return a response.");
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html")) {
      throw new Error(`Public website returned ${response.status} ${contentType}`.trim());
    }
    const html = await readLimitedText(response);
    page = extractPublicPage(html);
  } catch {
    page = null;
  }
  return synthesizeResearch(finalUrl.toString(), page, client);
}
