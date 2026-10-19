export type ApiErrorBody = {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
};

export class ApiClientError extends Error {
  code: string;
  details?: { path: string; message: string }[];
  constructor(body: ApiErrorBody) {
    super(body.error.message);
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    if (isJson && body?.error) throw new ApiClientError(body as ApiErrorBody);
    throw new Error(typeof body === "string" && body ? body : `Request failed (${res.status})`);
  }
  return body as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
