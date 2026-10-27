"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Dialog } from "../../../components/ui";
import { useUploadFeedback, UploadFeedbackPreview } from "../../../components/interactions/use-upload-feedback";
import {
  createCollection,
  importDesignAsset,
  listCollections,
} from "../generation/collection-api";
import type { CollectionDetail } from "../generation/collection-types";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "../file-upload-api";

export function WorkflowProjectPanels({
  projectId,
  onCollection,
}: {
  projectId: string;
  onCollection: (id: string) => void;
}) {
  const [panel, setPanel] = useState<"collections" | null>(null);
  const [collections, setCollections] = useState<readonly CollectionDetail[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadFeedback = useUploadFeedback();
  const load = useCallback(async () => {
    if (panel === "collections")
      setCollections(await listCollections(projectId));
  }, [panel, projectId]);
  useEffect(() => {
    if (!panel) return;
    let active = true;
    const refresh = () => {
      if (active)
        void load().catch((cause) => {
          if (active) setError(String(cause));
        });
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load, panel]);
  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button onClick={() => setPanel("collections")}>系列</Button>
      {panel ? (
        <Dialog
          label="系列工作台"
          onClose={() => {
            if (!busy) setPanel(null);
          }}
        >
          <h2>系列工作台</h2>
          <Button disabled={busy} onClick={() => setPanel(null)}>
            关闭
          </Button>
          {error ? (
            <p role="alert">
              {error}
              <Button onClick={() => void action(load)}>重试</Button>
            </p>
          ) : null}

              <label>
                上传主推款
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void action(async () => {
                      const invalid = validateImage(file);
                      if (invalid) throw new Error(invalid);
                      const upload = uploadFeedback.start(file);
                      try {
                      upload.stage("signing");
                      const signed = await signImageUpload(projectId, file, upload.signal);
                      upload.stage(signed.upload ? "uploading" : "processing");
                      const processing = signed.upload
                        ? await putOriginal(signed.upload, file, { signal: upload.signal, onProgress: upload.onProgress }).then(() => {
                            upload.stage("processing");
                            return completeUpload(signed.file.id, upload.signal);
                          },
                          )
                        : signed.file;
                      const ready = await waitForThumbnail(
                        signed.file.id,
                        processing,
                        60_000,
                        upload.signal,
                      );
                      upload.signal.throwIfAborted();
                      upload.stage("adding");
                      const asset = await importDesignAsset(
                        projectId,
                        ready.id,
                      );
                      const collection = await createCollection(asset.id);
                      upload.done(ready.thumbnail256Url ?? ready.thumbnail1024Url);
                      onCollection(collection.id);
                      setPanel(null);
                      } catch (cause) {
                        upload.fail();
                        if (!upload.signal.aborted) throw cause;
                      }
                    });
                    event.target.value = "";
                  }}
                />
              </label>
              <UploadFeedbackPreview preview={uploadFeedback.preview} onCancel={uploadFeedback.preview?.stage === "adding" ? undefined : uploadFeedback.cancel} onClear={uploadFeedback.clear} />
              {collections.map((collection) => (
                <p key={collection.id}>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      onCollection(collection.id);
                      setPanel(null);
                    }}
                  >
                    {collection.name}
                  </Button>
                </p>
              ))}
              {!collections.length ? (
                <p>暂无系列，可上传主推款或从候选方案建立系列。</p>
              ) : null}

        </Dialog>
      ) : null}
    </>
  );
}
