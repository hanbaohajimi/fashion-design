"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "../../../components/ui";
import { userFacingError } from "../../../components/user-facing-error";
import { navigateAfterSave } from "../../navigation";
import { importDesignAsset } from "../generation/collection-api";

/** Explicitly registers an uploaded canvas image; the existing leave guard still owns navigation. */
export function TryOnReferenceEntry({ projectId, fileAssetId, canEdit }: {
  readonly projectId: string;
  readonly fileAssetId: string;
  readonly canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return <div>
    <Button disabled={!canEdit || busy} loading={busy} onClick={() => {
      if (!canEdit || flight.current) return;
      flight.current = true;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          // importDesignAsset is idempotent for the same project and source file.
          const asset = await importDesignAsset(projectId, fileAssetId);
          if (!active.current) return;
          const left = await navigateAfterSave(() => {
            if (active.current) router.push(`/${encodeURIComponent(projectId)}/studio?tab=presentation&mode=realtime&assetId=${encodeURIComponent(asset.id)}`);
          });
          if (!left && active.current) setError("画布尚未保存，已留在当前页面。请处理保存问题后重试。");
        } catch (cause) { if (active.current) setError(userFacingError(cause)); }
        finally { flight.current = false; if (active.current) setBusy(false); }
      })();
    }}>实时试穿这张图片</Button>
    {error ? <Notice tone="error">{error}</Notice> : null}
  </div>;
}
