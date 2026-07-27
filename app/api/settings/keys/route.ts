import { requirePrincipalAsync } from "@/lib/auth";
import { HttpError, readJson, route } from "@/lib/http";
import {
  clearSecret,
  credentialStatus,
  encryptionModeAsync,
  normalizeCredentialField,
  putSecret,
  type CredentialField,
} from "@/lib/secrets";

/**
 * Per-advisor credential entry. Every response is the same status shape — set/source/hint and the
 * encryption mode in force. **No method here ever returns a credential value**, including the one
 * just submitted: the browser already has what it typed, and echoing it back would put keys in
 * response bodies, logs, and caches for no gain.
 */

export const dynamic = "force-dynamic";

interface FieldBody {
  field?: unknown;
  value?: unknown;
}

/** Unknown names are a 400, not a silently ignored write, so a typo cannot look like a success. */
function requireField(body: FieldBody): CredentialField {
  const field = normalizeCredentialField(body.field);
  if (!field) {
    throw new HttpError(400, `Unknown credential field: ${String(body.field ?? "")}`.trim());
  }
  return field;
}

async function payload(ownerId: string) {
  return {
    credentials: await credentialStatus(ownerId),
    encryptionMode: await encryptionModeAsync(),
  };
}

export async function GET(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    return payload(principal.ownerId);
  });
}

export async function PUT(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const body = await readJson<FieldBody>(request);
    const field = requireField(body);
    // A blank value is a clear, not a save; putSecret already collapses the two.
    await putSecret(principal.ownerId, field, typeof body.value === "string" ? body.value : "");
    return payload(principal.ownerId);
  });
}

export async function DELETE(request: Request) {
  return route(async () => {
    const principal = await requirePrincipalAsync(request);
    const body = await readJson<FieldBody>(request);
    const field = requireField(body);
    await clearSecret(principal.ownerId, field);
    return payload(principal.ownerId);
  });
}
