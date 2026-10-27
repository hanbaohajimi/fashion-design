"use client";

import { StudioPageHeader } from "./StudioPageHeader";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为本次任务与母图；任务类型和品牌为次级。唯一主操作提交当前任务，使用共享控件与 24/16/8px 间距。 */

import { useRef, useState } from "react";
import { UploadFeedbackPreview, useUploadFeedback } from "../../components/interactions/use-upload-feedback";
import type { StudioSummary } from "@fashion/shared";
import {
  Button,
  Field,
  Notice,
  Select,
  ChoiceSelect,
  Textarea,
  UploadInput,
  ImagePreview,
} from "../../components/ui";
import {
  fetchWorkflow,
  patchWorkflow,
  type WorkflowGraph,
  type WorkflowOperation,
} from "../board/workflow/workflow-api";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "../board/file-upload-api";
import { importDesignAsset } from "../board/generation/collection-api";
import { privateFetch } from "../auth/private-fetch";
import { useRouter } from "next/navigation";
import { AssetPicker } from "./studio-ui";
import { ActionBar, FormSection } from "../../components/workspace-ui";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { markMotion } from "../../components/motion/events";
import styles from "./studio.module.css";

type TaskKind = "sketch" | "combine" | "color" | "detail" | "brief";
export interface TaskDraft {
  kind: TaskKind;
  prompt: string;
  preserve: string;
  assetIds: string[];
  brandId: string;
}
const TASKS = [
  {
    kind: "sketch",
    name: "草图变效果图",
    description: "保留草图结构，明确材质与呈现方式。",
  },
  {
    kind: "combine",
    name: "组合多张参考",
    description: "指定一张母图，并加入廓形或风格参考。",
  },
  {
    kind: "color",
    name: "保留版型修改颜色",
    description: "说明要改变的色彩和必须保留的细节。",
  },
  {
    kind: "detail",
    name: "服装细节改款",
    description: "围绕领型、袖型、口袋或门襟建立修改分支。",
  },
  {
    kind: "brief",
    name: "梳理新的设计任务",
    description: "整理目标、保留项、变化项和未知项。",
  },
] as const satisfies readonly {
  kind: TaskKind;
  name: string;
  description: string;
}[];

export function compileStudioTask(
  draft: TaskDraft,
  graph: WorkflowGraph,
  ids: { toolId: string; briefId: string; sourceIds: string[] },
  data: Pick<StudioSummary, "assets" | "brandProfiles">,
): WorkflowOperation[] {
  if (draft.prompt.trim().length < 3)
    throw new Error("请至少用三个字描述任务。");
  if (draft.kind !== "brief" && !draft.assetIds.length)
    throw new Error("请先选择或上传母图。");
  if (draft.kind !== "brief" && draft.preserve.trim().length < 3)
    throw new Error("请明确需要保留的设计特征。");
  if (draft.assetIds.length > 12)
    throw new Error("一次任务最多使用 12 张图片。");
  const brand = data.brandProfiles.find((item) => item.id === draft.brandId);
  const brandText = brand
    ? "\n采用品牌资料 r" +
      brand.currentRevision.revision +
      "：" +
      JSON.stringify(brand.currentRevision.payload)
    : "";
  const prompt =
    draft.prompt.trim() +
    (draft.preserve.trim() ? "\n必须保留：" + draft.preserve.trim() : "") +
    brandText;
  if (prompt.length > 4000)
    throw new Error("任务与品牌规则超过 4000 字，请精简本次需求或品牌资料。");
  const y = graph.nodes.reduce((max, node) => Math.max(max, node.y), 0) + 320;
  const operations: WorkflowOperation[] = draft.assetIds.map(
    (assetId, index) => {
      const asset = data.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error("所选图片已不在项目中，请重新载入。");
      const sourceId = ids.sourceIds[index];
      if (!sourceId) throw new Error("任务图片节点未分配编号。");
      return {
        type: "add_node",
        node: {
          id: sourceId,
          kind: "asset",
          type: "reference_image",
          title: index === 0 ? "任务母图" : "任务参考 " + index,
          payload: {
            assetId,
            imageUrl: asset.url,
            role: "style_ref",
            roleSource: "manual",
          },
          x: index * 280,
          y,
        },
      };
    },
  );
  if (draft.kind === "brief") {
    operations.push({
      type: "add_node",
      node: {
        id: ids.briefId,
        kind: "asset",
        type: "brief",
        title: "设计任务",
        payload: {
          text: prompt,
          ...(brand ? { studioBrandRevisionId: brand.currentRevision.id } : {}),
        },
        x: 0,
        y: y - 250,
      },
    });
    operations.push({
      type: "add_node",
      node: {
        id: ids.toolId,
        kind: "tool",
        type: "analyze_brief",
        title: "整理设计需求",
        payload: {
          toolKey: "analyze_brief",
          toolVersion: "1",
          params: { prompt },
        },
        x: 360,
        y,
      },
    });
    operations.push({
      type: "add_edge",
      edge: {
        id: ids.toolId + "-goal",
        sourceNodeId: ids.briefId,
        targetNodeId: ids.toolId,
        sourcePort: "out",
        targetPort: "goal",
      },
    });
    ids.sourceIds.forEach((source, index) =>
      operations.push({
        type: "add_edge",
        edge: {
          id: ids.toolId + "-ref-" + index,
          sourceNodeId: source,
          targetNodeId: ids.toolId,
          sourcePort: "out",
          targetPort: "reference",
        },
      }),
    );
  } else {
    operations.push({
      type: "add_node",
      node: {
        id: ids.toolId,
        kind: "tool",
        type: "edit_design",
        title:
          TASKS.find((task) => task.kind === draft.kind)?.name ?? "服装修改",
        payload: {
          toolKey: "edit_design",
          toolVersion: "1",
          params: {
            taskType: "i2i",
            prompt,
            count: 1,
            width: 768,
            height: 1024,
            referenceInputs: ids.sourceIds
              .slice(1)
              .map((nodeId) => ({ nodeId, role: "style_ref", weight: 0.7 })),
          },
          ...(brand ? { studioBrandRevisionId: brand.currentRevision.id } : {}),
        },
        x: 360,
        y: y + 280,
      },
    });
    ids.sourceIds.forEach((source, index) =>
      operations.push({
        type: "add_edge",
        edge: {
          id: ids.toolId + "-input-" + index,
          sourceNodeId: source,
          targetNodeId: ids.toolId,
          sourcePort: "out",
          targetPort: index === 0 ? "source" : "reference",
        },
      }),
    );
  }
  return operations;
}

export function TaskEntry(
  props: StudioPanelProps & { readonly data: StudioSummary },
) {
  const form = useStudioForm<TaskDraft>(
    { kind: "sketch", prompt: "", preserve: "", assetIds: [], brandId: "" },
    props.onDirty,
    { notifySaved: false },
  );
  const { draft, setDraft } = form;
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const uploadFeedback = useUploadFeedback();
  const uploadFlight = useRef(false);
  const [uploaded, setUploaded] = useState<StudioSummary["assets"]>([]);
  const packet = useRef<{
    signature: string;
    mutationId: string;
    executeMutationId: string;
    baseRevision: number;
    toolId: string;
    operations: WorkflowOperation[];
  } | null>(null);
  const assets = [
    ...props.data.assets,
    ...uploaded.filter(
      (asset) => !props.data.assets.some((item) => item.id === asset.id),
    ),
  ];
  const currentTask =
    TASKS.find((task) => task.kind === draft.kind) ?? TASKS[0];
  const chooseTask = (kind: TaskKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      assetIds:
        kind === "combine" || kind === "brief"
          ? current.assetIds
          : current.assetIds.slice(0, 1),
    }));
  const submitLabel =
    draft.kind === "brief"
      ? "分析设计需求"
      : draft.kind === "sketch"
        ? "生成效果图"
        : draft.kind === "color"
          ? "生成配色方案"
          : "生成改款方案";
  const start = async () => {
    const succeeded = await form.submit(async (key) => {
      const graph = await fetchWorkflow(props.projectId);
      const signature = JSON.stringify(draft);
      if (packet.current?.signature !== signature) {
        const toolId = crypto.randomUUID();
        packet.current = {
          signature,
          mutationId: key,
          executeMutationId: crypto.randomUUID(),
          baseRevision: graph.revision,
          toolId,
          operations: compileStudioTask(
            draft,
            graph,
            {
              toolId,
              briefId: crypto.randomUUID(),
              sourceIds: draft.assetIds.map(() => crypto.randomUUID()),
            },
            { ...props.data, assets },
          ),
        };
      }
      const current = packet.current;
      if (!graph.nodes.some((node) => node.id === current.toolId))
        await patchWorkflow(props.projectId, {
          mode: "semantic",
          mutationId: current.mutationId,
          baseRevision: current.baseRevision,
          operations: current.operations,
        });
      const response = await privateFetch(
        "/api/projects/" +
          encodeURIComponent(props.projectId) +
          "/workflow/nodes/" +
          current.toolId +
          "/execute",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mutationId: current.executeMutationId }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          body?.message ?? "节点已建立，执行未成功。重试将继续原任务。",
        );
      }
      markMotion(
        `node:${current.toolId}`,
        "needle",
        `execute:${current.executeMutationId}`,
      );
    });
    if (succeeded) {
      props.onDirty(false);
      await router.push("/" + encodeURIComponent(props.projectId));
    }
  };
  const upload = async (file: File) => {
    if (uploadFlight.current || !props.canEdit) return;
    const error = validateImage(file);
    if (error) {
      form.setError(error);
      return;
    }
    setUploading(true);
    uploadFlight.current = true;
    const transfer = uploadFeedback.start(file);
    form.setError(null);
    try {
      transfer.stage("signing");
      const signed = await signImageUpload(props.projectId, file, transfer.signal);
      let processing = signed.file;
      if (signed.upload) {
        transfer.stage("uploading");
        await putOriginal(signed.upload, file, { signal: transfer.signal, onProgress: transfer.onProgress });
        transfer.stage("processing");
        processing = await completeUpload(signed.file.id, transfer.signal);
      }
      transfer.stage("processing");
      const ready = await waitForThumbnail(signed.file.id, processing, 60_000, transfer.signal);
      transfer.signal.throwIfAborted(); transfer.stage("adding");
      const asset = await importDesignAsset(props.projectId, ready.id);
      transfer.signal.throwIfAborted();
      const url =
        "/api/design-assets/" + encodeURIComponent(asset.id) + "/content";
      setUploaded((items) => [
        ...items,
        { id: asset.id, url, thumbnailUrl: ready.thumbnail256Url },
      ]);
      setDraft((current) => ({
        ...current,
        assetIds: [...current.assetIds.slice(0, 11), asset.id],
      }));
      transfer.done(ready.thumbnail256Url ?? url);
      await props.onSaved();
    } catch (cause) {
      transfer.fail();
      if (!transfer.signal.aborted) form.setError(cause instanceof Error ? cause.message : "图片上传失败");
    } finally {
      uploadFlight.current = false;
      setUploading(false);
    }
  };
  return (
    <form
      className={styles.taskWorkspace}
      aria-label="开始设计任务"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <div className={styles.taskContent}>
        <StudioPageHeader
          title={currentTask.name}
          type="开始任务"
          description={currentTask.description}
          actions={
            <ChoiceSelect label="任务类型" value={draft.kind} disabled={form.busy || uploading}
              options={TASKS.map((task) => ({ value: task.kind, label: task.name, description: task.description }))}
              onValueChange={(value) => chooseTask(value as TaskKind)} />
          }
        />
        {form.error ? <Notice tone="error">{form.error}</Notice> : null}
        <fieldset
          className={styles.form}
          disabled={!props.canEdit || form.busy || uploading}
        >
          <div className={styles.taskBrief}>
            <Field label="本次任务">
              <Textarea
                rows={4}
                value={draft.prompt}
                maxLength={3000}
                required
                minLength={3}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
                placeholder="例如：将夹克草图呈现为棉尼龙材质效果图，采用灰绿色。"
              />
            </Field>
            <Field
              label="必须保留"
              hint="例如：短衣长、落肩、双贴袋、原有扣数。"
            >
              <Textarea
                rows={2}
                value={draft.preserve}
                maxLength={1000}
                required={draft.kind !== "brief"}
                minLength={draft.kind !== "brief" ? 3 : undefined}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    preserve: event.target.value,
                  }))
                }
              />
            </Field>
            {props.data.brandProfiles.length > 0 ? (
              <FormSection
                title="品牌关联"
                summary={
                  draft.brandId
                    ? `已关联：${props.data.brandProfiles.find((item) => item.id === draft.brandId)?.currentRevision.payload.name ?? "当前品牌"}`
                    : "未关联品牌"
                }
              >
                <Field label="采用品牌资料">
                  <Select searchable
                    value={draft.brandId}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        brandId: event.target.value,
                      }))
                    }
                  >
                    <option value="">本次不关联品牌</option>
                    {props.data.brandProfiles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.currentRevision.payload.name} · r
                        {item.currentRevision.revision}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FormSection>
            ) : null}
          </div>
          <div className={styles.taskSource}>
            <div className={styles.taskStage} aria-label="本次任务参考">
              {draft.assetIds.length ? (
                draft.assetIds.map((id, index) => (
                  <ImagePreview
                    key={id}
                    src={assets.find((asset) => asset.id === id)?.url}
                    alt={index === 0 ? "本次任务母图" : `任务参考 ${index + 1}`}
                  />
                ))
              ) : (
                <p className={styles.muted}>
                  选择草图或参考图，作为本次任务的起点。
                </p>
              )}
            </div>
            <FormSection
              title="选择或上传参考"
              summary={`已选 ${draft.assetIds.length} 张`}
              defaultOpen={!draft.assetIds.length}
            >
              <UploadInput
                aria-label="上传草图或参考图"
                label="上传草图或参考图"
                hint="支持 JPG、PNG、WebP、HEIC，最大 50MB。"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
              {assets.length > 0 ? (
                <AssetPicker
                  selectionPreview={false}
                  assets={assets}
                  selected={draft.assetIds}
                  max={
                    draft.kind === "combine" || draft.kind === "brief" ? 12 : 1
                  }
                  label={
                    draft.kind === "brief"
                      ? "可选设计参考"
                      : "第一张为母图，其余为参考"
                  }
                  onChange={(ids) =>
                    setDraft((current) => ({ ...current, assetIds: ids }))
                  }
                />
              ) : null}
            </FormSection>
          </div>
        </fieldset>
        <UploadFeedbackPreview preview={uploadFeedback.preview} onCancel={uploadFeedback.preview?.stage === "adding" ? undefined : uploadFeedback.cancel} onClear={uploadFeedback.clear} />
        <div className={styles.note}>
          {draft.kind === "brief"
            ? "将建立需求分析任务，本步骤不生成图片。"
            : "生成成功后按额度计次；尺寸与面料物性需人工确认。"}
        </div>
        <ActionBar status={<span>完成后在画布查看进度和结果。</span>}>
          <Button
            type="submit"
            variant="primary"
            loading={form.busy || uploading}
            disabled={!props.canEdit}
          >
            {form.busy ? "正在提交…" : uploading ? "正在上传…" : submitLabel}
          </Button>
        </ActionBar>
      </div>
    </form>
  );
}
