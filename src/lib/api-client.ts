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

// --- Client-side GET cache -------------------------------------------------
// Module-level (per browser tab, survives App Router soft navigations, reset on
// full reload). GETs are TTL-cached and de-duplicated while in flight; any
// non-GET through apiFetch (or an explicit invalidateApiCache()) drops everything,
// so a write is never followed by a stale read. Entries are scoped to
// userId+organizationId via setApiCacheScope() so switching org / user can't
// surface another tenant's data.

type Entry = { data: unknown; expires: number };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let scope: string | null = null;
let generation = 0; // bumped on invalidate so responses that started before a write aren't stored

const MIN = 60_000;
// Slow-changing reference data gets a long TTL; everything else a short one.
const TTL_RULES: [RegExp, number][] = [
  [/^\/api\/(lookups|departments|designations|locations|leave\/types|holidays)(\?|$)/, 5 * MIN],
  [/^\/api\/me(\?|$)/, MIN],
];
const DEFAULT_TTL = 15_000;
const ttlFor = (url: string) => TTL_RULES.find(([re]) => re.test(url))?.[1] ?? DEFAULT_TTL;

export function invalidateApiCache() {
  generation++;
  store.clear();
  inflight.clear();
}

/** Call with `${userId}:${organizationId}`; clears the cache when it changes. */
export function setApiCacheScope(next: string) {
  if (scope !== next) {
    scope = next;
    invalidateApiCache();
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();

  if (method !== "GET") {
    invalidateApiCache(); // drop in-flight reads that could land stale
    try {
      return await request<T>(url, init);
    } finally {
      invalidateApiCache(); // and anything cached while the write was running
    }
  }

  // Opt out per call with `{ cache: "no-store" }`, e.g. a manual refresh; the fresh result repopulates the cache.
  if (init?.cache === "no-store") {
    const gen = generation;
    const fresh = await request<T>(url, init);
    if (gen === generation) store.set(url, { data: fresh, expires: Date.now() + ttlFor(url) });
    return fresh;
  }

  const hit = store.get(url);
  if (hit && hit.expires > Date.now()) return hit.data as T;
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const gen = generation;
  const p: Promise<T> = request<T>(url, init)
    .then((data) => {
      if (gen === generation) store.set(url, { data, expires: Date.now() + ttlFor(url) });
      return data;
    })
    .finally(() => {
      if (inflight.get(url) === p) inflight.delete(url);
    });
  inflight.set(url, p);
  return p;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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
