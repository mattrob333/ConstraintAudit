import { env } from "cloudflare:workers";
import {
  deleteSecretRow,
  getAppConfig,
  listSecretRows,
  putAppConfig,
  putSecretRow,
} from "./store";

/**
 * Per-advisor credentials that can be pasted and saved **in the app**.
 *
 * This is a deliberate, temporary posture change, taken with the tradeoff understood: setting every
 * key as a Cloudflare secret through wrangler is too slow to iterate against. What it actually buys
 * and what it does not:
 *
 * - A **server secret in the environment always wins.** App-saved values are only a fallback, so the
 *   moment the owner hardens a credential by setting the real Cloudflare secret, that value takes
 *   over automatically and a stale app-saved key cannot shadow it. `sourceOf` reports which one is
 *   actually in use, so the UI can tell the truth rather than imply the safer one.
 * - Secret fields are encrypted at rest with AES-GCM (random 12-byte IV per value). The master key
 *   comes from the `APP_ENCRYPTION_KEY` binding when it is set (`encryptionMode() === "app-key"`).
 * - **Without that binding the key is generated once and persisted in `app_config`, i.e. beside the
 *   data it protects** (`"generated-key"`). That defends against a casual dump of the secrets table
 *   and against a leaked backup of it alone — it does *not* defend against anyone who can read the
 *   whole database, since they can read the key too. It exists so testing needs zero configuration.
 *   `APP_ENCRYPTION_KEY` is the upgrade, and moving real credentials to Cloudflare secrets is the
 *   real fix.
 *
 * Never log a value from here, and never return a decrypted value to a caller that will send it to
 * a browser. `credentialStatus` is the only owner-facing view: set/source/hint, never the value.
 */

export const SECRET_FIELDS = [
  "OPENAI_API_KEY",
  "FIREFLIES_API_KEY",
  "RESEND_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
] as const;

/** Not credentials: a from-address and model names. Stored in plaintext so they stay inspectable. */
export const PLAIN_FIELDS = [
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "OPENAI_RESEARCH_MODEL",
  "OPENAI_TRANSCRIPT_MODEL",
] as const;

/** Every field this module accepts, in display order. */
export const CREDENTIAL_FIELDS = [...SECRET_FIELDS, ...PLAIN_FIELDS] as const;

export type SecretField = (typeof SECRET_FIELDS)[number];
export type PlainField = (typeof PLAIN_FIELDS)[number];
export type CredentialField = (typeof CREDENTIAL_FIELDS)[number];
export type CredentialSource = "server-secret" | "saved-in-app" | "none";
export type EncryptionMode = "app-key" | "generated-key";

/** Resolved credential lookup handed to the adapters. */
export interface Credentials {
  get(name: string): string;                    // "" when unset
  sourceOf(name: string): CredentialSource;
}

export interface CredentialStatus {
  field: string;
  set: boolean;
  source: CredentialSource;
  hint: string;
}

const KEY_CONFIG_KEY = "encryption_key";
const KEY_BINDING = "APP_ENCRYPTION_KEY";
const KEY_BYTES = 32;
const IV_BYTES = 12;
/** Below this length a masked tail would leak most of the value, so no hint is shown at all. */
const MIN_HINT_LENGTH = 8;
const HINT_TAIL = 4;
/** Plain values are echoed back for display; cap the length so a pasted blob cannot bloat a response. */
const MAX_PLAIN_HINT = 60;

function isSecretField(field: string): field is SecretField {
  return (SECRET_FIELDS as readonly string[]).includes(field);
}

function isPlainField(field: string): field is PlainField {
  return (PLAIN_FIELDS as readonly string[]).includes(field);
}

export function isCredentialField(field: string): field is CredentialField {
  return isSecretField(field) || isPlainField(field);
}

/**
 * Normalise a caller-supplied field name, or `null` when it is not one we know. Case-insensitive
 * because these names are shouted constants and a lowercase paste is an easy mistake to make.
 */
export function normalizeCredentialField(field: unknown): CredentialField | null {
  const name = typeof field === "string" ? field.trim().toUpperCase() : "";
  return isCredentialField(name) ? name : null;
}

/** Bindings are absent under `next build` and in plain node test runs; never let that throw. */
function binding(name: string): string {
  try {
    const value = (env as unknown as Record<string, unknown>)[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// The explicit `ArrayBuffer` type argument keeps the result assignable to `BufferSource`, which
// `crypto.subtle` requires; a bare `Uint8Array` widens to `ArrayBufferLike` and is rejected.
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Accepts base64 or hex; anything that is not exactly 32 bytes is rejected rather than padded. */
function decodeKeyMaterial(raw: string): Uint8Array<ArrayBuffer> | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const decoded = hexToBytes(value) ?? base64ToBytes(value);
  return decoded && decoded.length === KEY_BYTES ? decoded : null;
}

async function importKey(material: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Mint the deployment's generated key, or adopt the one already stored. The re-read after the write
 * is what makes two concurrent first requests converge on a single key: whichever INSERT lands last
 * wins for everybody, instead of one request encrypting under a key that is immediately overwritten.
 */
async function ensureGeneratedKey(): Promise<Uint8Array<ArrayBuffer> | null> {
  const stored = decodeKeyMaterial(await getAppConfig(KEY_CONFIG_KEY));
  if (stored) return stored;
  const fresh = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  await putAppConfig(KEY_CONFIG_KEY, bytesToBase64(fresh));
  return decodeKeyMaterial(await getAppConfig(KEY_CONFIG_KEY)) ?? fresh;
}

/** Cached per isolate. Reset on failure so a transient D1 error cannot poison the whole isolate. */
let cachedKey: Promise<CryptoKey | null> | null = null;

function masterKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    const configured = decodeKeyMaterial(binding(KEY_BINDING));
    if (configured) return importKey(configured);
    const generated = await ensureGeneratedKey();
    return generated ? importKey(generated) : null;
  })().catch(() => {
    cachedKey = null;
    return null;
  });
  return cachedKey;
}

/**
 * Which master key is in force. Synchronous, so it can only report on the binding — when the binding
 * is absent the answer is "generated-key" whether or not that key has been minted yet.
 */
export function encryptionMode(): EncryptionMode {
  return decodeKeyMaterial(binding(KEY_BINDING)) ? "app-key" : "generated-key";
}

/** Same answer, but also mints the generated key if this deployment has never needed one. */
export async function encryptionModeAsync(): Promise<EncryptionMode> {
  if (decodeKeyMaterial(binding(KEY_BINDING))) return "app-key";
  await masterKey().catch(() => null);
  return "generated-key";
}

async function encrypt(value: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await masterKey();
  // Refusing is the only honest outcome: storing the value anyway would silently write plaintext.
  if (!key) throw new Error("Invalid encryption configuration: no usable master key is available.");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(sealed)), iv: bytesToBase64(iv) };
}

/** Total: a corrupt row, a rotated key, or a missing key all yield "" — i.e. "unset", never a throw. */
async function decrypt(ciphertext: string, iv: string): Promise<string> {
  try {
    const key = await masterKey();
    const sealed = base64ToBytes(ciphertext);
    const nonce = base64ToBytes(iv);
    if (!key || !sealed || !nonce || nonce.length !== IV_BYTES) return "";
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed);
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

/** Display-only. Secrets get a masked tail (nothing at all when short); plain values are shown. */
function hintFor(field: string, value: string): string {
  if (isPlainField(field)) return value.slice(0, MAX_PLAIN_HINT);
  if (value.length < MIN_HINT_LENGTH) return "";
  return `…${value.slice(-HINT_TAIL)}`;
}

interface SavedValue {
  value: string;
  hint: string;
}

/**
 * Every app-saved value for one advisor, decrypted. Internal — the plaintext in this map must never
 * reach a response body. Defensive: an unreadable database or an unknown field yields no entry
 * rather than an error, because a missing credential is already a state every caller handles.
 */
async function loadSaved(ownerId: string): Promise<Map<string, SavedValue>> {
  const saved = new Map<string, SavedValue>();
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = await listSecretRows(ownerId);
  } catch {
    return saved;
  }
  for (const row of rows) {
    const field = typeof row.field === "string" ? row.field : "";
    if (!isCredentialField(field)) continue;
    const ciphertext = typeof row.ciphertext === "string" ? row.ciphertext : "";
    const iv = typeof row.iv === "string" ? row.iv : "";
    // An empty `iv` marks a PLAIN_FIELDS row: the column holds the value itself, not a ciphertext.
    const value = iv ? await decrypt(ciphertext, iv) : ciphertext;
    if (!value) continue;
    const hint = typeof row.hint === "string" ? row.hint : "";
    saved.set(field, { value, hint: hint || hintFor(field, value) });
  }
  return saved;
}

/**
 * Credential lookup for the adapters, with the environment taking precedence over app-saved values
 * for every field. Snapshot semantics: the saved values are read once, so a long request cannot see
 * a credential change underneath it.
 */
export async function resolveCredentials(ownerId: string): Promise<Credentials> {
  const saved = await loadSaved(ownerId);
  return {
    get(name: string): string {
      return binding(name) || saved.get(name)?.value || "";
    },
    sourceOf(name: string): CredentialSource {
      if (binding(name)) return "server-secret";
      return saved.get(name)?.value ? "saved-in-app" : "none";
    },
  };
}

/**
 * Save one credential for one advisor. A blank value clears the row instead of storing an empty
 * string, so "cleared" and "saved as empty" cannot drift apart. Unknown field names are rejected.
 */
export async function putSecret(ownerId: string, field: string, value: string): Promise<void> {
  const name = normalizeCredentialField(field);
  if (!name) throw new Error(`Invalid credential field: ${String(field)}`);
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    await clearSecret(ownerId, name);
    return;
  }
  const hint = hintFor(name, trimmed);
  if (isPlainField(name)) {
    // Deliberately plaintext, marked by the empty `iv`. Encrypting a model name buys nothing and
    // would make the row impossible to inspect when debugging a deployment.
    await putSecretRow(ownerId, name, trimmed, "", hint);
    return;
  }
  const { ciphertext, iv } = await encrypt(trimmed);
  await putSecretRow(ownerId, name, ciphertext, iv, hint);
}

/** `false` when nothing was saved for that field. An unknown field name is not an error to clear. */
export async function clearSecret(ownerId: string, field: string): Promise<boolean> {
  const name = normalizeCredentialField(field);
  if (!name) return false;
  return deleteSecretRow(ownerId, name);
}

/**
 * The only owner-facing view of credentials: whether each field resolves, where the value in force
 * comes from, and a display-only hint. Never includes a value. A row whose ciphertext no longer
 * decrypts reports as unset, which is exactly how `resolveCredentials` will treat it.
 */
export async function credentialStatus(ownerId: string): Promise<CredentialStatus[]> {
  const saved = await loadSaved(ownerId);
  return CREDENTIAL_FIELDS.map((field) => {
    const server = binding(field);
    if (server) {
      return { field, set: true, source: "server-secret" as const, hint: hintFor(field, server) };
    }
    const entry = saved.get(field);
    if (entry?.value) {
      return { field, set: true, source: "saved-in-app" as const, hint: entry.hint };
    }
    return { field, set: false, source: "none" as const, hint: "" };
  });
}
