import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  imageTextScanSchema,
  type ImageTextRect,
  type ImageTextScan,
} from "@fashion/shared";
import {
  useDraftScope,
  usePersistentDraft,
} from "../../../components/drafts/use-persistent-draft";
import { imageRequest } from "./image-workspace-api";
import type { ImageSize } from "./ImageViewer";
import {
  emptyImageTextDraft,
  imageTextDraftBaseline,
  parseImageTextDraft,
  type ImageTextDraft,
} from "./image-text-editor";

export function useImageTextEditor(assetId: string, size: ImageSize | null) {
  const scope = useDraftScope();
  // A distinct visit token also rejects late results after A → B → A navigation.
  const owner = useMemo(
    () => ({
      accountId: scope?.accountId,
      projectId: scope?.projectId,
      editor: scope?.editor,
      assetId,
    }),
    [scope?.accountId, scope?.projectId, scope?.editor, assetId],
  );
  const initial = {
    owner,
    draft: emptyImageTextDraft,
    scanning: false,
    error: null as string | null,
    notice: null as string | null,
  };
  const [state, setState] = useState(initial);
  const { draft, scanning, error, notice } =
    state.owner === owner ? state : initial;
  const live = useRef<object>(owner);
  useLayoutEffect(() => {
    live.current = owner;
    return () => {
      live.current = {};
    };
  }, [owner]);
  const patch = (change: (value: typeof initial) => typeof initial) => {
    if (live.current === owner)
      setState((value) => change(value.owner === owner ? value : initial));
  };
  const setDraft = (
    change: ImageTextDraft | ((value: ImageTextDraft) => ImageTextDraft),
  ) =>
    patch((value) => ({
      ...value,
      draft: typeof change === "function" ? change(value.draft) : change,
    }));
  const persistence = usePersistentDraft({
    value: draft,
    baseline: imageTextDraftBaseline,
    objectKey: `image-text:${assetId}`,
    restore: (value) => {
      const parsed = parseImageTextDraft(value);
      if (parsed) setDraft(parsed);
    },
  });
  const scanLock = useRef<object | null>(null);
  const scan = async () => {
    if (
      scanLock.current === owner ||
      !size ||
      size.width > 2048 ||
      size.height > 2048 ||
      !persistence.ready ||
      draft.regions.length
    )
      return;
    scanLock.current = owner;
    patch((value) => ({ ...value, scanning: true, error: null, notice: null }));
    try {
      const result = imageTextScanSchema.parse(
        await imageRequest<ImageTextScan>(
          `/api/design-assets/${encodeURIComponent(assetId)}/text-regions`,
          "POST",
          {},
        ),
      );
      if (live.current !== owner) return;
      if (result.width !== size.width || result.height !== size.height)
        throw new Error("识别图片与当前显示尺寸不一致，请重新打开原图");
      const regions = result.regions.map((region) => ({
        id: crypto.randomUUID(),
        original: region.text,
        replacement: region.text,
        rect: region.rect,
      }));
      const next = {
        regions,
        selected: regions[0]?.id ?? null,
        source: { width: result.width, height: result.height },
      };
      setDraft(next);
      await persistence.checkpoint(next, imageTextDraftBaseline);
      patch((value) => ({
        ...value,
        notice: regions.length
          ? `找到 ${regions.length} 处文字，请先核对原文与框选范围。`
          : "没有识别到可读文字，可以手动添加区域。",
      }));
    } catch (cause) {
      patch((value) => ({
        ...value,
        error:
          cause instanceof Error
            ? cause.message
            : "文字识别失败，可手动添加区域",
      }));
    } finally {
      if (scanLock.current === owner) scanLock.current = null;
      patch((value) => ({ ...value, scanning: false }));
    }
  };
  const selected =
    draft.regions.find((region) => region.id === draft.selected) ?? null;
  return {
    draft,
    selected,
    scanning,
    error,
    notice,
    ready: persistence.ready,
    checkpoint: () => persistence.checkpoint(draft, imageTextDraftBaseline),
    scan,
    select: (id: string) => setDraft((value) => ({ ...value, selected: id })),
    update: (
      id: string,
      value: Partial<{
        original: string;
        replacement: string;
        rect: ImageTextRect;
      }>,
    ) =>
      setDraft((current) => ({
        ...current,
        regions: current.regions.map((region) =>
          region.id === id
            ? {
                ...region,
                ...(value.original !== undefined &&
                value.replacement === undefined &&
                region.original === region.replacement
                  ? { replacement: value.original }
                  : {}),
                ...value,
              }
            : region,
        ),
      })),
    add: () => {
      if (!size || scanning || !persistence.ready || draft.regions.length >= 24)
        return;
      const region = {
        id: crypto.randomUUID(),
        original: "",
        replacement: "",
        rect: { x: 0.25, y: 0.4, width: 0.5, height: 0.12 },
      };
      setDraft((value) => ({
        ...value,
        source: size,
        selected: region.id,
        regions: [...value.regions, region],
      }));
    },
    remove: (id: string) =>
      setDraft((value) => {
        const regions = value.regions.filter((region) => region.id !== id);
        return { ...value, regions, selected: regions[0]?.id ?? null };
      }),
    clear: () => {
      if (scanLock.current === owner) return;
      patch((value) => ({
        ...value,
        draft: emptyImageTextDraft,
        error: null,
        notice: null,
      }));
      void persistence.checkpoint(emptyImageTextDraft, imageTextDraftBaseline);
    },
  };
}
