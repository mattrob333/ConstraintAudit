export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export function jsonError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status =
    error instanceof HttpError ? error.status :
    /not found/i.test(message) ? 404 :
    /conflict/i.test(message) ? 409 :
    /required|invalid|must|requires|blocked/i.test(message) ? 400 :
    500;
  return Response.json({ error: message }, { status });
}

export async function route<T>(handler: () => Promise<T>, init?: ResponseInit): Promise<Response> {
  try {
    return Response.json(await handler(), init);
  } catch (error) {
    return jsonError(error);
  }
}

export async function engagementId(context: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await context.params;
  if (!id) throw new HttpError(400, "Engagement id is required.");
  return id;
}
