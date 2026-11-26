"use client";

import { useSearchParams } from "next/navigation";

/**
 * Tab state kept in the URL's `?tab=` so links (e.g. from notifications) can open a
 * specific tab. Writes with history.replaceState, which Next syncs into useSearchParams
 * without a server round trip. Unknown values fall back to `fallback`.
 * Callers must sit inside a <Suspense> boundary (useSearchParams).
 */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  const tab = fromUrl !== null && (tabs as readonly string[]).includes(fromUrl) ? (fromUrl as T) : fallback;

  function setTab(t: T) {
    const next = new URLSearchParams(params.toString());
    if (t === fallback) next.delete("tab");
    else next.set("tab", t);
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }

  return [tab, setTab];
}
