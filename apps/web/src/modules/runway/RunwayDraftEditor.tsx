"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  runwayDraftSchema,
  type RunwayDraft,
  type RunwayShowView,
  type StudioSummary,
} from "@fashion/shared";
import {
  Button,
  Field,
  ImagePreview,
  Input,
  Notice,
  Select,
  Textarea,
  UploadInput,
} from "../../components/ui";
import {
  useStudioForm,
  type StudioPanelProps,
} from "../studio/use-studio-form";
import { useStudioAssetName } from "../studio/studio-object-context";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "../board/file-upload-api";
import { saveRunwayShow } from "./runway-api";
import { importDesignAsset } from "../board/generation/collection-api";
import styles from "./runway.module.css";

type InputKind = RunwayDraft["inputs"][number]["kind"];
const KIND_LABELS: Record<InputKind, string> = {
  model: "模特",
  cloth: "服装",
  background: "背景",
};

export function RunwayDraftEditor({
  projectId,
  data,
  canEdit,
  onDirty,
  onSaved,
  existing,
  initialStyleRevisionId,
  onSavedShow,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing?: RunwayShowView | undefined;
  readonly initialStyleRevisionId?: string | undefined;
  readonly onSavedShow: (show: RunwayShowView) => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reportDirty = useCallback(
    (dirty: boolean) => {
      if (mounted.current) onDirty(dirty);
    },
    [onDirty],
  );
  const form = useStudioForm(
    {
      title: existing?.title ?? "新服装秀",
      draft: existing?.draft ?? {
        prompt: "",
        modelCount: 6,
        withMusic: true,
        inputs: initialStyleRevisionId
          ? [
              {
                kind: "cloth" as const,
                sourceType: "style_revision" as const,
                sourceId: initialStyleRevisionId,
              },
            ]
          : [],
      },
    },
    reportDirty,
  );
  const { draft, setDraft } = form;
  const [kind, setKind] = useState<InputKind>("cloth");
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<
    Record<string, { name: string; url: string | null }>
  >({});
  const assetName = useStudioAssetName();
  const sources = data.styles.flatMap((style) => {
    const revisions = [
      style.currentRevision,
      ...style.revisions.filter(
        (revision) => revision.id !== style.currentRevision.id,
      ),
    ];
    return revisions.map((revision) => ({
      id: revision.id,
      label: `${style.name} · r${revision.revision}`,
      url:
        data.assets.find((asset) => asset.id === revision.payload.sourceAssetId)
          ?.url ?? null,
    }));
  });
  const addInput = (input: RunwayDraft["inputs"][number]) => {
    setDraft((current) => ({
      ...current,
      draft: {
        ...current.draft,
        inputs: [
          ...current.draft.inputs.filter(
            (item) =>
              !(input.kind === "background" && item.kind === "background") &&
              !(
                item.kind === input.kind &&
                item.sourceType === input.sourceType &&
                item.sourceId === input.sourceId
              ),
          ),
          input,
        ],
      },
    }));
  };
  const save = async () => {
    const parsed = runwayDraftSchema.safeParse(draft.draft);
    if (!draft.title.trim() || !parsed.success) {
      form.setError(
        !draft.title.trim()
          ? "请填写服装秀名称"
          : (parsed.error?.issues[0]?.message ?? "请检查需求资料"),
      );
      return;
    }
    await form.submit(async (requestKey) => {
      const saved = await saveRunwayShow(
        projectId,
        { title: draft.title.trim(), draft: parsed.data },
        requestKey,
        existing,
      );
      if (mounted.current) onSavedShow(saved);
    });
  };
  const upload = async (file: File) => {
    const issue = validateImage(file);
    if (issue) {
      form.setError(issue);
      return;
    }
    setUploading(true);
    form.setError(null);
    try {
      const signed = await signImageUpload(projectId, file);
      const processing = signed.upload
        ? await putOriginal(signed.upload, file).then(() =>
            completeUpload(signed.file.id),
          )
        : signed.file;
      const ready = await waitForThumbnail(signed.file.id, processing);
      const asset = await importDesignAsset(projectId, ready.id);
      setUploaded((current) => ({
        ...current,
        [asset.id]: {
          name: ready.name,
          url:
            ready.thumbnail256Url ??
            `/api/design-assets/${encodeURIComponent(asset.id)}/content`,
        },
      }));
      addInput({ kind, sourceType: "asset", sourceId: asset.id });
      await onSaved();
    } catch (error) {
      form.setError(
        error instanceof Error ? error.message : "图片上传失败，请重试",
      );
    } finally {
      setUploading(false);
    }
  };
  return (
    <form
      className={styles.draft}
      aria-label="服装秀需求与素材"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.formHeader}>
        <div>
          <h3>需求与素材</h3>
          <p>保存需求后开始制作。已有素材会保留为本次运行的独立快照。</p>
        </div>
        {existing ? (
          <span className={styles.muted}>草稿版本 {existing.version}</span>
        ) : (
          <span className={styles.muted}>尚未保存</span>
        )}
      </div>
      <div className={styles.formGrid}>
        <Field label="服装秀名称">
          <Input
            aria-label="服装秀名称"
            required
            maxLength={200}
            value={draft.title}
            disabled={!canEdit || form.busy}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        </Field>
        <Field label="出场人数" hint="每个人物对应一个视频镜头。">
          <Input
            aria-label="出场人数"
            type="number"
            required
            min={1}
            step={1}
            value={draft.draft.modelCount}
            disabled={!canEdit || form.busy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                draft: {
                  ...current.draft,
                  modelCount: Number(event.target.value),
                },
              }))
            }
          />
        </Field>
      </div>
      <Field
        label="秀场需求"
        hint="描述服装、人物、场景、走秀动作和整体氛围；已有素材的用途可在下方指定。"
      >
        <Textarea
          aria-label="秀场需求"
          required
          maxLength={8000}
          rows={5}
          value={draft.draft.prompt}
          disabled={!canEdit || form.busy}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              draft: { ...current.draft, prompt: event.target.value },
            }))
          }
        />
      </Field>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={draft.draft.withMusic}
          disabled={!canEdit || form.busy}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              draft: { ...current.draft, withMusic: event.target.checked },
            }))
          }
        />
        为成片生成背景音乐
      </label>
      <fieldset
        className={styles.sourcePicker}
        disabled={!canEdit || form.busy || uploading}
      >
        <legend>参考素材</legend>
        <div className={styles.sourceControls}>
          <Field label="素材用途">
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as InputKind)}
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {value === "background" ? "秀场背景（单张）" : label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="选择项目素材">
            <Select
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">选择款式修订或设计图片</option>
              <optgroup label="款式修订">
                {sources.map((item) => (
                  <option key={item.id} value={`style_revision:${item.id}`}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="设计图片">
                {data.assets.map((item) => (
                  <option key={item.id} value={`asset:${item.id}`}>
                    {assetName(item.id)}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Button
            disabled={!source}
            onClick={() => {
              const [sourceType, sourceId] = source.split(":");
              if (
                sourceId &&
                (sourceType === "asset" || sourceType === "style_revision")
              ) {
                addInput({ kind, sourceType, sourceId });
                setSource("");
              }
            }}
          >
            加入素材
          </Button>
          <UploadInput
            label={uploading ? "正在上传…" : "上传参考图"}
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            disabled={!canEdit || form.busy || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </div>
        {!draft.draft.inputs.length ? (
          <p className={styles.muted}>
            可以不添加参考图，由需求生成模特、服装和背景。
          </p>
        ) : null}
        {kind === "background" ? (
          <p className={styles.muted}>
            秀场共用一张背景，再次添加会替换当前背景。
          </p>
        ) : null}
        <ul className={styles.sourceList}>
          {draft.draft.inputs.map((input, index) => {
            const style = sources.find(
              (item) =>
                input.sourceType === "style_revision" &&
                item.id === input.sourceId,
            );
            const asset = data.assets.find(
              (item) =>
                input.sourceType === "asset" && item.id === input.sourceId,
            );
            const upload = uploaded[input.sourceId];
            const label =
              style?.label ??
              (asset ? assetName(asset.id) : (upload?.name ?? "已上传参考图"));
            const url =
              style?.url ??
              asset?.thumbnailUrl ??
              asset?.url ??
              upload?.url ??
              undefined;
            return (
              <li key={`${input.kind}:${input.sourceType}:${input.sourceId}`}>
                <span className={styles.sourceImage}>
                  <ImagePreview src={url} alt={label} />
                </span>
                <span>
                  <strong>{label}</strong>
                  <small>
                    {KIND_LABELS[input.kind]}参考 ·{" "}
                    {input.sourceType === "style_revision"
                      ? "绑定款式修订"
                      : "图片"}
                  </small>
                </span>
                {canEdit ? (
                  <Button
                    size="small"
                    disabled={form.busy}
                    aria-label={`移除素材 ${index + 1}`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        draft: {
                          ...current.draft,
                          inputs: current.draft.inputs.filter(
                            (_, at) => at !== index,
                          ),
                        },
                      }))
                    }
                  >
                    移除
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
      {form.error ? <Notice tone="error">{form.error}</Notice> : null}
      <div className={styles.toolbar}>
        {canEdit ? (
          <Button
            type="submit"
            variant="primary"
            loading={form.busy}
            disabled={uploading || existing?.archived}
          >
            保存需求
          </Button>
        ) : null}
        <span className={styles.muted}>
          {form.dirty
            ? "有未保存修改"
            : existing
              ? "需求已保存"
              : "保存后可开始制作"}
        </span>
      </div>
    </form>
  );
}
