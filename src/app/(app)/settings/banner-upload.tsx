"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, errorMessage, invalidateApiCache } from "@/lib/api-client";
import { Alert, Button, Card, CardTitle } from "@/components/ui";

/** Upload / remove the company banner shown at the top of every employee profile. */
export function BannerUpload() {
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<{ organization: { bannerUrl: string | null } }>("/api/me")
      .then((r) => setBannerUrl(r.organization.bannerUrl))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      // Plain fetch: apiFetch forces a JSON Content-Type, which breaks the multipart boundary.
      const res = await fetch("/api/organization/banner", { method: "PUT", body });
      invalidateApiCache();
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? `Upload failed (${res.status})`);
      setBannerUrl(json.bannerUrl);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/organization/banner", { method: "DELETE" });
      invalidateApiCache();
      setBannerUrl(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardTitle>Company banner</CardTitle>
      <p className="mb-4 text-sm text-muted-foreground">Shown at the top of every employee profile. Use a wide image, about 1500 × 300 px. JPEG, PNG or WebP, up to 5 MB.</p>
      <div className="relative mb-4 h-28 overflow-hidden rounded-xl bg-night ring-1 ring-inset ring-border sm:h-36">
        {bannerUrl ? (
          // Served by our auth-checked API route (private bucket), so next/image's optimizer can't fetch it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="Company banner" className="size-full object-cover" />
        ) : (
          <p className="flex size-full items-center justify-center text-sm text-white/60">No banner yet, the default artwork is shown</p>
        )}
      </div>
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      <div className="flex gap-3">
        <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Saving…" : bannerUrl ? "Change banner" : "Upload banner"}
        </Button>
        {bannerUrl && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={remove}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}
