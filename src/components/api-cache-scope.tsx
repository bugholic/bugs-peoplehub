"use client";

import { setApiCacheScope } from "@/lib/api-client";

/**
 * Renders nothing. Binds the client GET cache to the active user + org during
 * render (not in an effect) so it runs before any child page's mount effect fetches.
 * Idempotent: it only clears when the scope actually changes.
 */
export function ApiCacheScope({ scope }: { scope: string }) {
  setApiCacheScope(scope);
  return null;
}
