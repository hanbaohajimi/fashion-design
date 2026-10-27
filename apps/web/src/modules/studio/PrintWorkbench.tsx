"use client";

import { AssetSelect } from "./studio-ui";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为图案大预览；320px 参数区支持调整与生产规格确认。保存为主操作，平铺与坐标计算保持原值。 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSubmitFeedback } from "../../components/interactions/use-submit-feedback";
import {
  studioPrintPatternSchema,
  type StudioAssetView,
  type StudioDocumentView,
} from "@fashion/shared";
import { privateFetch } from "../auth/private-fetch";
import { Button, Input, Textarea } from "../../components/ui";
import { ActionBar, FormSection } from "../../components/workspace-ui";
import styles from "./print-workbench.module.css";
import { StudioEditSection } from "./StudioEditSection";
import { StudioPageHeader } from "./StudioPageHeader";
type Pattern = (typeof studioPrintPatternSchema)["_output"];
const CONTROLS = [
  { key: "scale", label: "重复尺度", min: 0.1, max: 5, step: 0.1 },
  { key: "rotation", label: "旋转角度", min: 0, max: 360, step: 1 },
  { key: "brightness", label: "亮度", min: 0.2, max: 2, step: 0.05 },
  { key: "offsetX", label: "水平位置", min: -1, max: 1, step: 0.05 },
  { key: "offsetY", label: "垂直位置", min: -1, max: 1, step: 0.05 },
] as const;
export function PrintWorkbench({
  projectId,
  assets,
  documents,
  canEdit = true,
  onRefresh,
  onDirty,
  beforeChange,
}: {
  projectId: string;
  assets: readonly StudioAssetView[];
  documents: readonly StudioDocumentView[];
  canEdit?: boolean;
  onRefresh?: () => void;
  onDirty?: (dirty: boolean) => void;
  beforeChange?: () => Promise<boolean>;
}) {
  const feedback = useSubmitFeedback();
  const savedPattern = studioPrintPatternSchema.safeParse(
    documents[0]?.currentRevision.payload,
  );
  const initial = savedPattern.success
    ? savedPattern.data
    : studioPrintPatternSchema.parse({
        name: "印花方案",
        sourceAssetId: assets[0]?.id ?? "pending",
        notes: "",
      });
  const [value, setValue] = useState<Pattern>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const signature = JSON.stringify(value);
  useEffect(() => {
    onDirty?.(signature !== baseline);
    return () => onDirty?.(false);
  }, [signature, baseline, onDirty]);
  const [editing, setEditing] = useState<StudioDocumentView | null>(
    savedPattern.success ? (documents[0] ?? null) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<{ body: string; key: string } | null>(null);
  const asset = assets.find((asset) => asset.id === value.sourceAssetId);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [previewResult, setPreviewResult] = useState<{
    url: string;
    attempt: number;
    failed: boolean;
  } | null>(null);
  const previewReady =
    previewResult?.url === asset?.url &&
    previewResult?.attempt === previewAttempt;
  useEffect(() => {
    if (!asset) return;
    let active = true;
    const image = new window.Image();
    const complete = (failed: boolean) => {
      if (active)
        setPreviewResult({ url: asset.url, attempt: previewAttempt, failed });
    };
    image.onload = () => complete(false);
    image.onerror = () => complete(true);
    image.src = asset.url;
    return () => {
      active = false;
    };
  }, [asset, previewAttempt]);
  const update = <K extends keyof Pattern>(key: K, next: Pattern[K]) => {
    if (feedback.snapshot.phase === "success" || feedback.snapshot.phase === "error") feedback.reset();
    setValue((current) => ({
      ...current,
      [key]: next,
      reviewed: key === "reviewed" ? Boolean(next) : false,
    }));
  };
  const save = async () => {
    setError(null);
    setNotice(null);
    const parsed = studioPrintPatternSchema.safeParse(value);
    if (!parsed.success || !asset) {
      setError(
        parsed.success
          ? "请选择真实图案素材"
          : (parsed.error.issues[0]?.message ?? "参数无效"),
      );
      return;
    }
    const content = {
      type: "PRINT_PATTERN",
      payload: parsed.data,
      ...(editing
        ? { documentId: editing.id, expectedVersion: editing.version }
        : {}),
    };
    const body = JSON.stringify(content);
    if (pending.current?.body !== body)
      pending.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    const receipt = feedback.begin("save");
    try {
      const response = await privateFetch(
        "/api/projects/" + encodeURIComponent(projectId) + "/studio/documents",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...content,
            requestKey: pending.current?.key ?? crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(result.message ?? "保存失败");
      }
      const saved = (await response.json()) as StudioDocumentView;
      setEditing(saved);
      setBaseline(JSON.stringify(parsed.data));
      onDirty?.(false);
      pending.current = null;
      setNotice("印花参数已保存为修订 " + saved.version);
      receipt.succeed();
      onRefresh?.();
    } catch (cause) {
      receipt.fail();
      setError(cause instanceof Error ? cause.message : "印花保存失败");
    } finally {
      setBusy(false);
    }
  };
  const slider = (control: (typeof CONTROLS)[number]) => (
    <label key={control.key}>
      {control.label} ·{" "}
      {control.key === "rotation"
        ? `${value[control.key]}°`
        : control.key === "offsetX" || control.key === "offsetY"
          ? `${Math.round(value[control.key] * 100)} px`
          : `${value[control.key]} 倍`}
      <input
        aria-label={control.label}
        type="range"
        disabled={!canEdit || busy}
        min={control.min}
        max={control.max}
        step={control.step}
        style={{ "--range-fill": `${((value[control.key] - control.min) / (control.max - control.min)) * 100}%` } as CSSProperties}
        value={value[control.key]}
        onChange={(event) => update(control.key, Number(event.target.value))}
      />
    </label>
  );
  return (
    <section className={styles.panel} aria-label="印花工作台">
      <StudioPageHeader
        title={value.name || "新印花方案"}
        type="印花工作台"
        description={`${editing ? `修订 ${editing.version}` : "新方案"} · 调整重复效果并人工核对`}
      />
      <div className={styles.layout}>
        <div
          className={styles.preview}
          aria-label="图案平铺预览"
          aria-busy={Boolean(asset && !previewReady)}
        >
          {asset && previewReady && !previewResult?.failed ? (
            <div
              style={
                {
                  backgroundImage:
                    'url("' + asset.url.replaceAll('"', "%22") + '")',
                  backgroundSize: Math.round(value.scale * 180) + "px",
                  backgroundPosition:
                    value.offsetX * 100 + "px " + value.offsetY * 100 + "px",
                  transform: "rotate(" + value.rotation + "deg)",
                  filter: "brightness(" + value.brightness + ")",
                } as CSSProperties
              }
            />
          ) : asset ? (
            <section className={styles.previewStatus} role="status">
              <p>{previewReady ? "图案暂时无法加载" : "正在加载图案…"}</p>
              {previewReady ? (
                <Button
                  onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
                >
                  重试预览
                </Button>
              ) : null}
            </section>
          ) : (
            <p>先上传或选择图案素材</p>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <StudioEditSection
            persistent
            title="编辑图案资料"
            summary={value.name}
            defaultOpen={!editing}
            save={canEdit}
            busy={busy}
            error={error}
          >
            <label>
              方案名称
              <Input
                required
                disabled={!canEdit || busy}
                value={value.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </label>
            <label>
              原始图案
              <AssetSelect
                disabled={!canEdit || busy}
                value={value.sourceAssetId}
                onValueChange={(assetId) =>
                  update("sourceAssetId", assetId)
                }
               assets={assets} />
            </label>
          </StudioEditSection>
          {CONTROLS.slice(0, 2).map(slider)}
          <Button
            disabled={!canEdit || busy}
            onClick={() => {
              setValue((current) => ({
                ...current,
                scale: 1,
                rotation: 0,
                brightness: 1,
                offsetX: 0,
                offsetY: 0,
                reviewed: false,
              }));
              setNotice("画布参数已重置。保存后将更新印花修订。");
            }}
          >
            重置画布参数
          </Button>
          <FormSection
            title="高级调整"
            summary={`亮度 ${value.brightness} · 位置 ${value.offsetX}, ${value.offsetY}`}
          >
            {CONTROLS.slice(2).map(slider)}
          </FormSection>
          <FormSection
            title="生产规格"
            summary={
              value.tileWidthCm && value.tileHeightCm
                ? `${value.tileWidthCm} × ${value.tileHeightCm} cm · 需人工确认`
                : "宽高待确认"
            }
          >
            <p>这里的比例属于屏幕视觉设定，生产尺寸需要另行确认。</p>
            <label>
              生产重复宽度（cm，待确认可留空）
              <Input
                type="number"
                min={0.1}
                max={1000}
                step={0.1}
                disabled={!canEdit || busy}
                value={value.tileWidthCm ?? ""}
                onChange={(event) =>
                  update(
                    "tileWidthCm",
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                  )
                }
              />
            </label>
            <label>
              生产重复高度（cm，待确认可留空）
              <Input
                type="number"
                min={0.1}
                max={1000}
                step={0.1}
                disabled={!canEdit || busy}
                value={value.tileHeightCm ?? ""}
                onChange={(event) =>
                  update(
                    "tileHeightCm",
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                  )
                }
              />
            </label>
          </FormSection>
          <FormSection title="备注" summary={value.notes ? "已填写" : "未填写"}>
            <label>
              备注
              <Textarea
                disabled={!canEdit || busy}
                value={value.notes}
                onChange={(event) => update("notes", event.target.value)}
              />
            </label>
          </FormSection>
          <label className={styles.check}>
            <input
              type="checkbox"
              disabled={!canEdit || busy}
              checked={value.reviewed}
              onChange={(event) => update("reviewed", event.target.checked)}
            />
            已人工检查重复边缘和视觉效果
          </label>
          {canEdit ? (
            <ActionBar
              status={
                signature !== baseline
                  ? "有未保存的修改"
                  : editing
                    ? "已保存"
                    : "新方案尚未保存"
              }
            >
              <Button
                type="submit"
                loading={busy}
                feedback={feedback.snapshot}
                variant="primary"
                disabled={Boolean(editing) && signature === baseline}
              >
                {editing ? "保存新修订" : "保存印花方案"}
              </Button>
            </ActionBar>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </form>
      </div>
      <div className={styles.saved}>
        <h3>已保存的图案方案</h3>
        {!documents.length ? (
          <p>保存后可在其他设计任务中引用原始图案与应用说明。</p>
        ) : (
          documents.map((document) => (
            <button
              key={document.id}
              aria-pressed={editing?.id === document.id}
              type="button"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  if (beforeChange && !(await beforeChange())) return;
                  feedback.reset();
                  const parsed = studioPrintPatternSchema.safeParse(
                    document.currentRevision.payload,
                  );
                  if (parsed.success) {
                    setValue(parsed.data);
                    setBaseline(JSON.stringify(parsed.data));
                    onDirty?.(false);
                    setEditing(document);
                    setNotice(null);
                    setError(null);
                  }
                })()
              }
            >
              {document.currentRevision.payload.name} · 修订 {document.version}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
