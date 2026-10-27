"use client";
import { GridDetails } from "../../components/GridDetails";

import { useSubmitFeedback } from "../../components/interactions/use-submit-feedback";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为当前品牌摘要与分组字段；共享库和历史为次级。保存为主操作，参考图使用完整预览。 */

import { useRef, useState } from "react";
import type {
  StudioDocumentInput,
  StudioDocumentView,
  StudioSummary,
} from "@fashion/shared";
import { Button, Field, Input, Notice, Textarea } from "../../components/ui";
import {
  fetchWorkflow,
  patchWorkflow,
  type WorkflowOperation,
} from "../board/workflow/workflow-api";
import {
  fetchBrandLibrary,
  importBrand,
  saveStudioDocument,
} from "./studio-api";
import { AssetPicker, SaveBar } from "./studio-ui";
import { ObjectSwitcher, FormSection } from "../../components/workspace-ui";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import styles from "./studio.module.css";
import { StudioEditSection } from "./StudioEditSection";
import { StudioPageHeader } from "./StudioPageHeader";

type Brand = Extract<StudioDocumentInput, { type: "BRAND_PROFILE" }>["payload"];
function blank(): Brand {
  return {
    name: "",
    colors: [],
    silhouettes: [],
    signatureDetails: [],
    fabricPreferences: [],
    avoid: [],
    notes: "",
    referenceAssetIds: [],
  };
}
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function BrandLibrary(
  props: StudioPanelProps & { readonly data: StudioSummary },
) {
  const feedback = useSubmitFeedback();
  const beforeChange = async () => {
    const allowed = await props.beforeChange();
    if (allowed) feedback.reset();
    return allowed;
  };
  const [id, setId] = useState<string | null>(
    props.data.brandProfiles[0]?.id ?? null,
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const [library, setLibrary] = useState<StudioDocumentView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imports = useRef(new Map<string, string>());
  const openLibrary = async () => {
    setBusy(true);
    setError(null);
    try {
      setLibrary(await fetchBrandLibrary(props.projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "品牌资料读取失败");
    } finally {
      setBusy(false);
    }
  };
  const reuse = async (brand: StudioDocumentView) => {
    if (!(await beforeChange())) return;
    setBusy(true);
    setError(null);
    const revisionId = brand.currentRevision.id;
    let key = imports.current.get(revisionId);
    if (!key) {
      key = crypto.randomUUID();
      imports.current.set(revisionId, key);
    }
    try {
      const saved = await importBrand(props.projectId, revisionId, key);
      await props.onSaved();
      setId(saved.id);
      imports.current.delete(revisionId);
      setLibrary(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "品牌复用失败");
    } finally {
      setBusy(false);
    }
  };
  const existing = props.data.brandProfiles.find((item) => item.id === id);
  return (
    <div className={styles.section}>
      <StudioPageHeader
        objectSwitcher={
          props.data.brandProfiles.length > 0 ? (
            <ObjectSwitcher
              label="切换对象"
              current={
                <>
                  切换资料 {" "}
                  {existing?.currentRevision.payload.name ?? "新建资料"}
                </>
              }
            >
              <aside className={styles.rail} aria-label="品牌列表">
                {props.data.brandProfiles.map((item) => (
                  <Button
                    aria-pressed={id === item.id}
                    key={item.id}
                    onClick={() =>
                      void (async () => {
                        if (await beforeChange()) setId(item.id);
                      })()
                    }
                  >
                    <strong>{item.currentRevision.payload.name}</strong>
                    <small>r{item.currentRevision.revision}</small>
                  </Button>
                ))}
              </aside>
            </ObjectSwitcher>
          ) : null
        }
        title={String(existing?.currentRevision.payload.name ?? "新品牌资料")}
        type="品牌资料"
        description="整理设计规则、品牌色与认可案例"
        actions={
          props.canEdit ? (
            <Button
              onClick={() =>
                void (async () => {
                  if (await beforeChange()) {
                    setId(null);
                    setDraftVersion((current) => current + 1);
                  }
                })()
              }
            >
              新建品牌
            </Button>
          ) : null
        }
      />
      <div className={styles.split}>
        <BrandEditor
          key={
            (existing?.id ?? "new") +
            ":" +
            (existing?.version ?? 0) +
            ":" +
            draftVersion
          }
          {...props}
          feedback={feedback}
          beforeChange={beforeChange}
          existing={existing}
          onCreated={setId}
        />
      </div>
      {props.canEdit ? (
        <FormSection title="共享品牌库" summary="按需从其他有权访问的项目复用">
          <Button loading={busy} onClick={() => void openLibrary()}>
            从其他项目复用品牌资料
          </Button>
          <p className={styles.muted}>
            只显示你有权访问的个人品牌资料；导入会保存为本项目的独立修订。认可案例需要在本项目重新选择。
          </p>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {library ? (
            <div className={styles.toolbar}>
              {library.length ? (
                library.map((brand) => (
                  <Button
                    key={brand.currentRevision.id}
                    disabled={busy}
                    onClick={() => void reuse(brand)}
                  >
                    {brand.currentRevision.payload.name} 修订 {brand.version}
                  </Button>
                ))
              ) : (
                <p>其他可访问项目暂无个人品牌资料。</p>
              )}
            </div>
          ) : null}
        </FormSection>
      ) : null}
    </div>
  );
}

function BrandEditor({
  data,
  projectId,
  canEdit,
  onDirty,
  onSaved,
  beforeChange,
  feedback,
  existing,
  onCreated,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioDocumentView | undefined;
  readonly onCreated: (id: string) => void;
}) {
  const form = useStudioForm(
    existing ? (existing.currentRevision.payload as Brand) : blank(),
    onDirty,
    { feedback, draftKey: existing?.id ?? "new" },
  );
  const { draft, setDraft } = form;
  const pendingApply = useRef<{
    key: string;
    baseRevision: number;
    operations: WorkflowOperation[];
  } | null>(null);
  const [applied, setApplied] = useState(false);
  const update = <K extends keyof Brand>(key: K, value: Brand[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    let savedId = "";
    if (
      await form.submit(async (key) => {
        const saved = await saveStudioDocument(
          projectId,
          { type: "BRAND_PROFILE", payload: draft },
          key,
          existing,
        );
        savedId = saved.id;
      })
    ) {
      await onSaved();
      onCreated(savedId);
    }
  };
  const apply = async () => {
    if (!existing || form.dirty) {
      form.setError("请先保存品牌资料修订，再应用到工作流。");
      return;
    }
    await form.submit(async (key) => {
      if (pendingApply.current?.key !== key) {
        const graph = await fetchWorkflow(projectId);
        const prefix =
          "brand-" + existing.currentRevision.id + "-" + key.slice(0, 8);
        const content = [
          "品牌：" +
            draft.name +
            "，资料修订 r" +
            existing.currentRevision.revision,
          "色彩：" +
            draft.colors
              .map((color) => color.name + " " + color.hex)
              .join("、"),
          "常用廓形：" + draft.silhouettes.join("、"),
          "标志细节：" + draft.signatureDetails.join("、"),
          "偏好面料：" + draft.fabricPreferences.join("、"),
          "避免事项：" + draft.avoid.join("、"),
          draft.notes,
        ].join("\n");
        const operations: WorkflowOperation[] = [
          {
            type: "add_node",
            node: {
              id: prefix,
              type: "reference_text",
              kind: "asset",
              title: "品牌规则 " + draft.name,
              payload: {
                text: content,
                studioDocumentId: existing.id,
                studioRevisionId: existing.currentRevision.id,
              },
              x: 40,
              y: graph.nodes.length * 40 + 40,
            },
          },
        ];
        draft.referenceAssetIds.forEach((assetId, index) =>
          operations.push({
            type: "add_node",
            node: {
              id: prefix + "-ref-" + index,
              kind: "asset",
              type: "reference_image",
              title: draft.name + " 认可案例 " + (index + 1),
              payload: {
                assetId,
                imageUrl:
                  data.assets.find((asset) => asset.id === assetId)?.url ?? "",
                role: "style_ref",
                roleSource: "manual",
                studioRevisionId: existing.currentRevision.id,
              },
              x: 40 + (index + 1) * 300,
              y: graph.nodes.length * 40 + 40,
            },
          }),
        );
        pendingApply.current = {
          key,
          baseRevision: graph.revision,
          operations,
        };
      }
      const packet = pendingApply.current;
      if (!packet) throw new Error("未建立品牌引用内容");
      await patchWorkflow(projectId, {
        mode: "semantic",
        mutationId: packet.key,
        baseRevision: packet.baseRevision,
        operations: packet.operations,
      });
      pendingApply.current = null;
      setApplied(true);
    }, "apply");
  };
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {form.error ? (
        <Notice tone="error">
          {form.error}
          {form.conflict ? (
            <Button
              onClick={() =>
                void (async () => {
                  if (await beforeChange()) await onSaved();
                })()
              }
            >
              重新载入
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {applied ? (
        <Notice tone="success">
          品牌规则与认可案例已加入画布，继续连入需要使用的任务。
        </Notice>
      ) : null}
      {existing ? (
        <section className={styles.brandSummary} aria-label="当前品牌修订摘要">
          <div>
            <p className={styles.muted}>
              {draft.silhouettes.join(" ") || "尚未填写常用廓形"}
            </p>
          </div>
          <div className={styles.brandColors}>
            {draft.colors.map((color, index) => (
              <span key={index}>
                <i style={{ background: color.hex }} />
                {color.name || color.hex}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <StudioEditSection
        persistent
        title="设计规则与案例"
        summary={`${draft.referenceAssetIds.length} 个认可案例`}
        defaultOpen={!existing}
        save={canEdit}
        busy={form.busy}
        error={form.error}
      >
        <fieldset
          disabled={!canEdit || form.busy}
          className={styles.brandFields}
        >
          <Field label="品牌名称">
            <Input
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <div className={styles.formGrid}>
            {(
              [
                ["silhouettes", "常用廓形"],
                ["signatureDetails", "标志性细节"],
                ["fabricPreferences", "面料偏好"],
                ["avoid", "避免事项"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label} hint="每行填写一项。">
                <Textarea
                  rows={4}
                  value={draft[key].join("\n")}
                  onChange={(event) => update(key, lines(event.target.value))}
                />
              </Field>
            ))}
          </div>
          <div className={styles.stack}>
            <h3>品牌色</h3>
            {draft.colors.map((color, index) => (
              <div className={styles.row} key={index}>
                <Input
                  aria-label={"颜色 " + (index + 1) + " 名称"}
                  required
                  value={color.name}
                  onChange={(event) =>
                    update(
                      "colors",
                      draft.colors.map((item, at) =>
                        at === index
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={"颜色 " + (index + 1) + " 色值"}
                  type="color"
                  value={color.hex}
                  onChange={(event) =>
                    update(
                      "colors",
                      draft.colors.map((item, at) =>
                        at === index
                          ? { ...item, hex: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  size="small"
                  onClick={() =>
                    update(
                      "colors",
                      draft.colors.filter((_, at) => at !== index),
                    )
                  }
                >
                  移除
                </Button>
              </div>
            ))}
            <Button
              disabled={draft.colors.length >= 30}
              onClick={() =>
                update("colors", [
                  ...draft.colors,
                  { name: "", hex: "#5a5149" },
                ])
              }
            >
              添加品牌色
            </Button>
          </div>
          <Field label="补充说明">
            <Textarea
              rows={3}
              maxLength={2000}
              value={draft.notes}
              onChange={(event) => update("notes", event.target.value)}
            />
          </Field>
          <section className={styles.brandReferences}>
            <AssetPicker
              compact
              disabled={!canEdit || form.busy}
              assets={data.assets}
              selected={draft.referenceAssetIds}
              max={12}
              onChange={(ids) => update("referenceAssetIds", ids)}
              label="认可的设计案例"
            />
          </section>
        </fieldset>
      </StudioEditSection>
      <SaveBar
        feedback={feedback?.snapshot}
        busy={form.busy}
        dirty={form.dirty}
        isNew={!existing}
        canEdit={canEdit}
      >
        <Button
          disabled={!existing || form.dirty || !canEdit}
          loading={form.busy}
          feedback={feedback?.snapshot}
          feedbackAction="apply"
          onClick={() => void apply()}
        >
          将此修订加入画布
        </Button>
      </SaveBar>
      {existing ? (
        <GridDetails className={styles.record}>
          <summary>品牌修订历史</summary>
          {existing.revisions.map((revision) => (
            <div className={styles.record} key={revision.id}>
              <strong>
                r{revision.revision} {revision.payload.name}
              </strong>
              <p className={styles.muted}>
                {(revision.payload as Brand).notes || "未填写补充说明"}
              </p>
              <small>
                {new Date(revision.createdAt).toLocaleString("zh-CN")}
              </small>
            </div>
          ))}
        </GridDetails>
      ) : null}
    </form>
  );
}
