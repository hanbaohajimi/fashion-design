"use client";

import { AssetSelect } from "./studio-ui";
import { GridDetails } from "../../components/GridDetails";

import { useSubmitFeedback } from "../../components/interactions/use-submit-feedback";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为同一份技术草稿与宽表格；章节目录和修订历史为次级。保存为主操作，不复制章节草稿。 */

import { BoundStyleContext } from "./studio-object-context";
import { useId, useRef, useState } from "react";
import {
  createTechPackDraft,
  serializeTechPackDraft,
  validateTechPack,
  TechPackDraftError,
  type TechPackDraft,
} from "./tech-pack-draft";
import {
  studioPublishIssues,
  type StudioTechPack,
  type StudioDocumentView,
  type StudioSummary,
} from "@fashion/shared";
import {
  Badge,
  Button,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from "../../components/ui";
import { saveStudioDocument, techPackExportUrl } from "./studio-api";
import { SaveBar } from "./studio-ui";
import {
  EditorChapters,
  ObjectSwitcher,
  revealInvalidField,
} from "../../components/workspace-ui";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { BomTable, PomTable } from "./TechPackTables";
import { AssetAnchor } from "./AssetAnchor";
import { TechPackExportButton } from "./TechPackExportButton";
import styles from "./studio.module.css";
import { StudioEditSection } from "./StudioEditSection";
import { StudioPageHeader } from "./StudioPageHeader";

export function TechPackEditor(
  props: StudioPanelProps & {
    readonly data: StudioSummary;
    readonly initialStyleRevisionId?: string | undefined;
  },
) {
  const feedback = useSubmitFeedback();
  const beforeChange = async () => {
    const allowed = await props.beforeChange();
    if (allowed) feedback.reset();
    return allowed;
  };
  const [id, setId] = useState<string | null>(
    (props.initialStyleRevisionId
      ? props.data.techPacks.find(
          (item) =>
            (item.currentRevision.payload as StudioTechPack).styleRevisionId ===
            props.initialStyleRevisionId,
        )?.id
      : props.data.techPacks[0]?.id) ?? null,
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const existing = props.data.techPacks.find((item) => item.id === id);
  return (
    <div className={styles.section}>
      <StudioPageHeader
        objectSwitcher={
          props.data.techPacks.length > 0 ? (
            <ObjectSwitcher
              label="切换技术包"
              current={existing?.currentRevision.payload.name ?? "新建资料"}
            >
              <aside className={styles.rail}>
                {props.data.techPacks.map((item) => (
                  <Button
                    key={item.id}
                    aria-pressed={id === item.id}
                    onClick={() =>
                      void (async () => {
                        if (await beforeChange()) setId(item.id);
                      })()
                    }
                  >
                    <strong>{item.currentRevision.payload.name}</strong>
                    <small>
                      r{item.currentRevision.revision} {" "}
                      {(item.currentRevision.payload as StudioTechPack)
                        .status === "PUBLISHED"
                        ? "已发布"
                        : "草稿"}
                    </small>
                  </Button>
                ))}
              </aside>
            </ObjectSwitcher>
          ) : null
        }
        title={String(existing?.currentRevision.payload.name ?? "新建技术包")}
        type="技术包"
        description="逐章整理制作资料，人工复核后发布"
        status={
          <Badge>
            {existing ? `已保存 r${existing.currentRevision.revision} ` : ""}
            {(existing?.currentRevision.payload as StudioTechPack | undefined)
              ?.status === "PUBLISHED"
              ? "已发布"
              : "草稿"}
          </Badge>
        }
        actions={
          <Button
            disabled={!props.canEdit}
            onClick={() =>
              void (async () => {
                if (await beforeChange()) {
                  setId(null);
                  setDraftVersion((current) => current + 1);
                }
              })()
            }
          >
            新建技术包
          </Button>
        }
      />
      <div className={styles.split}>
        <TechPackForm
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
    </div>
  );
}

function TechPackForm({
  projectId,
  data,
  existing,
  canEdit,
  onDirty,
  onSaved,
  beforeChange,
  feedback,
  onCreated,
  initialStyleRevisionId,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioDocumentView | undefined;
  readonly initialStyleRevisionId?: string | undefined;
  readonly onCreated: (id: string) => void;
}) {
  const firstRevision =
    data.styles
      .flatMap((style) => [style.currentRevision, ...style.revisions])
      .find((revision) => revision.id === initialStyleRevisionId) ??
    data.styles[0]?.currentRevision;
  const chapterId = useId();
  const [chapter, setChapter] = useState("basics");
  const initial: StudioTechPack = existing
    ? (existing.currentRevision.payload as StudioTechPack)
    : {
        name: "",
        styleRevisionId: firstRevision?.id ?? "",
        status: "DRAFT",
        views: firstRevision?.payload.views ?? [],
        annotations: [],
        bom: [],
        pom: [],
        colors: [],
        constructionNotes: "",
        reviewConfirmed: false,
      };
  const [initialDraft] = useState(() => createTechPackDraft(initial));
  const form = useStudioForm(initialDraft, onDirty, { feedback, draftKey: existing?.id ?? "new" });
  const formElement = useRef<HTMLFormElement>(null);
  const { draft, setDraft } = form;
  const [viewsChanged, setViewsChanged] = useState(false);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const validationId = `${chapterId}-validation`;
  const disabled = !canEdit || form.busy;
  const readiness = (() => {
    try {
      return studioPublishIssues(serializeTechPackDraft(draft));
    } catch {
      return ["请先补全或更正表格数值，再检查发布条件"];
    }
  })();
  const issueChapter = (issue: string) =>
    issue.includes("BOM")
      ? "bom"
      : issue.includes("POM")
        ? "pom"
        : issue.includes("视图")
          ? "views"
          : issue.includes("配色")
            ? "colors"
            : issue.includes("工艺")
              ? "annotations"
              : "review";
  const locateIssue = (issue: string) => {
    const next = issueChapter(issue);
    setChapter(next);
    requestAnimationFrame(() => {
      const regions = Array.from(
        formElement.current?.querySelectorAll<HTMLElement>(
          `[data-tech-chapter="${next}"]`,
        ) ?? [],
      );
      const region = regions[0];
      let label: string | undefined;
      if (next === "bom") {
        const index = draft.bom.findIndex(
          (row) =>
            !row.material ||
            !row.quantity.trim() ||
            row.source === "ai" ||
            !row.reviewed,
        );
        const row = draft.bom[index];
        if (row)
          label = `BOM ${index + 1} ${!row.material ? "材料" : !row.quantity.trim() ? "用量" : row.source === "ai" ? "依据" : "已复核"}`;
      } else if (next === "pom") {
        const index = draft.pom.findIndex(
          (row) =>
            !row.value.trim() ||
            !row.tolerance.trim() ||
            row.source === "ai" ||
            !row.reviewed,
        );
        const row = draft.pom[index];
        if (row)
          label = `POM ${index + 1} ${!row.value.trim() ? "尺寸" : !row.tolerance.trim() ? "公差" : row.source === "ai" ? "依据" : "已复核"}`;
      }
      const controls = regions.flatMap((item) =>
        Array.from(
          item.querySelectorAll<HTMLElement>(
            "input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)",
          ),
        ),
      );
      const control =
        (label
          ? controls.find((item) => item.getAttribute("aria-label") === label)
          : undefined) ??
        controls.find(
          (item) =>
            item instanceof HTMLInputElement &&
            item.type === "checkbox" &&
            !item.checked,
        ) ??
        controls[0];
      (control ?? region)?.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
      control?.focus({ preventScroll: true });
    });
  };
  const update = <K extends keyof TechPackDraft>(
    key: K,
    value: TechPackDraft[K],
  ) => {
    if (invalidField) {
      setInvalidField(null);
      form.setError(null);
    }
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === "reviewConfirmed" ? {} : { reviewConfirmed: false }),
      status: "DRAFT",
    }));
  };
  const save = async (publish = false) => {
    let payload: StudioTechPack;
    try {
      payload = serializeTechPackDraft(draft);
    } catch (error) {
      showValidationError(error);
      return;
    }
    payload.status = publish ? "PUBLISHED" : "DRAFT";
    if (publish) {
      const issues = studioPublishIssues(payload);
      if (issues.length) {
        form.setError(issues.join("；"));
        setChapter("review");
        return;
      }
    }
    try {
      validateTechPack(payload);
    } catch (error) {
      showValidationError(error);
      return;
    }
    let id = "";
    if (
      await form.submit(async (key) => {
        const result = await saveStudioDocument(
          projectId,
          { type: "TECH_PACK", payload },
          key + (publish ? "-publish" : "-draft"),
          existing,
        );
        id = result.id;
      }, publish ? "publish" : "save")
    ) {
      const normalized = createTechPackDraft(payload);
      form.reset({
        ...normalized,
        bom: normalized.bom.map((row, index) => ({
          ...row,
          uiId: draft.bom[index]?.uiId ?? row.uiId,
        })),
        pom: normalized.pom.map((row, index) => ({
          ...row,
          uiId: draft.pom[index]?.uiId ?? row.uiId,
        })),
      });
      await onSaved();
      onCreated(id);
    }
  };
  const showValidationError = (error: unknown) => {
    form.setError(error instanceof Error ? error.message : "请检查技术资料");
    if (!(error instanceof TechPackDraftError)) return;
    setInvalidField(error.label);
    setChapter(error.chapter);
    requestAnimationFrame(() => {
      const input = Array.from(
        formElement.current?.querySelectorAll<HTMLElement>(
          "[aria-label],input,select",
        ) ?? [],
      ).find(
        (element) =>
          element.getAttribute("aria-label") === error.label ||
          (error.label === "技术包名称" &&
            element instanceof HTMLInputElement &&
            element.value === draft.name),
      );
      // Use the same disclosure/focus path as native constraint validation.
      input?.dispatchEvent(new Event("invalid", { cancelable: true }));
      input?.focus();
    });
  };
  return (
    <form
      ref={formElement}
      className={`${styles.form} ${styles.chapterForm}`}
      onInvalidCapture={(event) =>
        revealInvalidField(event, () => {
          const target = event.target as HTMLElement;
          setChapter(
            target.closest<HTMLElement>("[data-tech-chapter]")?.dataset
              .techChapter ?? "basics",
          );
        })
      }
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {form.error ? (
        <div id={validationId}>
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
        </div>
      ) : null}
      {viewsChanged ? (
        <Notice>关联视图已更换。相关锚点已标为待复核，请逐一重新定位。</Notice>
      ) : null}
      <BoundStyleContext data={data} revisionId={draft.styleRevisionId} />
      <StudioEditSection
        persistent
        title="编辑技术包资料"
        summary={
          <span>
            {draft.name || "新建技术包"} {" "}
            {readiness.length ? `${readiness.length} 项待复核` : "可进入复核"}
          </span>
        }
        defaultOpen={!existing}
        save={canEdit}
        busy={form.busy}
        error={form.error}
      >
        <Field label="技术包名称">
          <Input
            aria-invalid={invalidField === "技术包名称" || undefined}
            aria-describedby={
              invalidField === "技术包名称" ? validationId : undefined
            }
            value={draft.name}
            disabled={disabled}
            required
            maxLength={120}
            onChange={(event) => update("name", event.target.value)}
          />
        </Field>
      </StudioEditSection>
      <EditorChapters
        active={chapter}
        onChange={setChapter}
        chapters={[
          { value: "basics", label: "基本资料" },
          { value: "views", label: "视图来源" },
          { value: "annotations", label: "工艺标注" },
          { value: "bom", label: "BOM" },
          { value: "pom", label: "POM" },
          { value: "colors", label: "配色" },
          { value: "review", label: "复核发布" },
        ].map((item) => ({
          ...item,
          pending: readiness.filter(
            (issue) => issueChapter(issue) === item.value,
          ).length,
        }))}
      />
      {chapter === "review" ? (
        <section className={styles.reviewReadiness} aria-label="发布准备情况">
          <h3>
            {readiness.length
              ? `还有 ${readiness.length} 项待复核`
              : "复核条件已满足"}
          </h3>
          {readiness.length ? (
            <ul>
              {readiness.map((issue) => (
                <li key={issue}>
                  <button type="button" onClick={() => locateIssue(issue)}>
                    {issue}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>保存当前修改后，可人工确认发布。导出使用已保存的修订。</p>
          )}
        </section>
      ) : null}
      <fieldset disabled={disabled} className={styles.form}>
        <div
          data-tech-chapter="basics"
          hidden={chapter !== "basics"}
          id={`${chapterId}-basics`}
          className={styles.formGrid}
        >
          <Field label="对应款式修订">
            <Select searchable
              required
              value={draft.styleRevisionId}
              onChange={(event) => {
                const revision = data.styles
                  .flatMap((style) => style.revisions)
                  .find((item) => item.id === event.target.value);
                setDraft((current) => ({
                  ...current,
                  styleRevisionId: event.target.value,
                  views:
                    revision?.payload.views.map((view) => ({
                      ...view,
                      reviewed: false,
                    })) ?? [],
                  annotations: [],
                  status: "DRAFT",
                  reviewConfirmed: false,
                }));
              }}
            >
              <option value="">选择已保存的款式修订</option>
              {data.styles.flatMap((style) =>
                style.revisions.map((revision) => (
                  <option value={revision.id} key={revision.id}>
                    {style.code} {revision.payload.name} r
                    {revision.revision}
                  </option>
                )),
              )}
            </Select>
          </Field>
        </div>
        <section
          data-tech-chapter="views"
          hidden={chapter !== "views"}
          id={`${chapterId}-views`}
          className={styles.section}
        >
          <div className={styles.recordHeader}>
            <h3>视图与来源</h3>
            <Button
              disabled={!data.assets.length || draft.views.length >= 20}
              onClick={() =>
                update("views", [
                  ...draft.views,
                  {
                    kind: "detail",
                    assetId: data.assets[0]?.id ?? "",
                    label: "",
                    reviewed: false,
                  },
                ])
              }
            >
              添加视图
            </Button>
          </div>
          {draft.views.map((view, index) => (
            <div className={styles.record} key={index}>
              <div className={styles.formGrid}>
                <Field label="类型">
                  <Select
                    value={view.kind}
                    onChange={(event) =>
                      update(
                        "views",
                        draft.views.map((item, at) =>
                          at === index
                            ? {
                                ...item,
                                kind: event.target.value as typeof view.kind,
                                reviewed: false,
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="front">正面</option>
                    <option value="back">背面</option>
                    <option value="detail">细节</option>
                  </Select>
                </Field>
                <Field label="关联图片">
                  <AssetSelect
                    value={view.assetId}
                    onValueChange={(assetId) => {
                      const oldAsset = view.assetId;
                      setViewsChanged(true);
                      setDraft((current) => ({
                        ...current,
                        status: "DRAFT",
                        reviewConfirmed: false,
                        views: current.views.map((item, at) =>
                          at === index
                            ? {
                                ...item,
                                assetId: assetId,
                                reviewed: false,
                              }
                            : item,
                        ),
                        annotations: current.annotations.map((item) =>
                          item.assetId === oldAsset
                            ? {
                                ...item,
                                assetId: assetId,
                                reviewed: false,
                              }
                            : item,
                        ),
                      }));
                    }}
                   assets={data.assets} />
                </Field>
                <Field label="视图说明">
                  <Input
                    value={view.label}
                    maxLength={2000}
                    onChange={(event) =>
                      update(
                        "views",
                        draft.views.map((item, at) =>
                          at === index
                            ? {
                                ...item,
                                label: event.target.value,
                                reviewed: false,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={view.reviewed}
                  onChange={(event) =>
                    update(
                      "views",
                      draft.views.map((item, at) =>
                        at === index
                          ? { ...item, reviewed: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />
                已人工复核此视图，确认图中结构
              </label>
              <div className={styles.toolbar}>
                <Button
                  size="small"
                  onClick={() => {
                    const remaining = draft.views.filter(
                      (_, at) => at !== index,
                    );
                    if (
                      draft.annotations.some(
                        (item) => item.assetId === view.assetId,
                      ) &&
                      !remaining.some((item) => item.assetId === view.assetId)
                    ) {
                      form.setError(
                        "此视图仍有工艺标注，请先重新关联或移除标注。",
                      );
                      return;
                    }
                    update("views", remaining);
                  }}
                >
                  移除视图
                </Button>
              </div>
            </div>
          ))}
        </section>
        <section
          data-tech-chapter="annotations"
          hidden={chapter !== "annotations"}
          id={`${chapterId}-annotations`}
          className={styles.section}
        >
          <div className={styles.recordHeader}>
            <h3>工艺锚点标注</h3>
            <Button
              disabled={!draft.views.length || draft.annotations.length >= 100}
              onClick={() =>
                update("annotations", [
                  ...draft.annotations,
                  {
                    assetId: draft.views[0]?.assetId ?? "",
                    x: 0.5,
                    y: 0.5,
                    text: "",
                    reviewed: false,
                  },
                ])
              }
            >
              添加标注
            </Button>
          </div>
          {draft.annotations.map((annotation, index) => (
            <article className={styles.record} key={index}>
              <Field label="标注图片">
                <AssetSelect
                  value={annotation.assetId}
                  onValueChange={(assetId) =>
                    update(
                      "annotations",
                      draft.annotations.map((item, at) =>
                        at === index
                          ? {
                              ...item,
                              assetId: assetId,
                              reviewed: false,
                            }
                          : item,
                      ),
                    )
                  }
                 assets={data.assets.filter((asset) => draft.views.some((view) => view.assetId === asset.id))} />
              </Field>
              <AssetAnchor
                label={"工艺标注 " + (index + 1) + " 定位"}
                url={
                  data.assets.find((asset) => asset.id === annotation.assetId)
                    ?.url ?? ""
                }
                x={annotation.x}
                y={annotation.y}
                onPoint={(x, y) =>
                  update(
                    "annotations",
                    draft.annotations.map((item, at) =>
                      at === index ? { ...item, x, y, reviewed: false } : item,
                    ),
                  )
                }
              />
              <Field label="工艺说明">
                <Input
                  maxLength={120}
                  required
                  value={annotation.text}
                  onChange={(event) =>
                    update(
                      "annotations",
                      draft.annotations.map((item, at) =>
                        at === index
                          ? {
                              ...item,
                              text: event.target.value,
                              reviewed: false,
                            }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={annotation.reviewed}
                  onChange={(event) =>
                    update(
                      "annotations",
                      draft.annotations.map((item, at) =>
                        at === index
                          ? { ...item, reviewed: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />
                已复核工艺标注
              </label>
              <Button
                size="small"
                onClick={() =>
                  update(
                    "annotations",
                    draft.annotations.filter((_, at) => at !== index),
                  )
                }
              >
                移除标注
              </Button>
            </article>
          ))}
        </section>
        <div
          data-tech-chapter="bom"
          hidden={chapter !== "bom"}
          id={`${chapterId}-bom`}
        >
          <BomTable
            error={
              invalidField
                ? { label: invalidField, id: validationId }
                : undefined
            }
            rows={draft.bom}
            disabled={disabled}
            onChange={(rows) => update("bom", rows)}
          />
        </div>
        <div
          data-tech-chapter="pom"
          hidden={chapter !== "pom"}
          id={`${chapterId}-pom`}
        >
          <PomTable
            error={
              invalidField
                ? { label: invalidField, id: validationId }
                : undefined
            }
            rows={draft.pom}
            disabled={disabled}
            onChange={(rows) => update("pom", rows)}
          />
        </div>
        <section
          data-tech-chapter="colors"
          hidden={chapter !== "colors"}
          id={`${chapterId}-colors`}
          className={styles.stack}
        >
          <div className={styles.recordHeader}>
            <h3>配色</h3>
            <Button
              disabled={draft.colors.length >= 30}
              onClick={() =>
                update("colors", [
                  ...draft.colors,
                  { name: "", hex: "#5a5149", reviewed: false },
                ])
              }
            >
              添加配色
            </Button>
          </div>
          {draft.colors.map((color, index) => (
            <div className={styles.row} key={index}>
              <Field label="色名">
                <Input
                  required
                  value={color.name}
                  onChange={(event) =>
                    update(
                      "colors",
                      draft.colors.map((item, at) =>
                        at === index
                          ? {
                              ...item,
                              name: event.target.value,
                              reviewed: false,
                            }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="色值">
                <Input
                  type="color"
                  value={color.hex}
                  onChange={(event) =>
                    update(
                      "colors",
                      draft.colors.map((item, at) =>
                        at === index
                          ? {
                              ...item,
                              hex: event.target.value,
                              reviewed: false,
                            }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={color.reviewed}
                  onChange={(event) =>
                    update(
                      "colors",
                      draft.colors.map((item, at) =>
                        at === index
                          ? { ...item, reviewed: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />
                已复核
              </label>
              <Button
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
        </section>
        <div data-tech-chapter="review" hidden={chapter !== "review"}>
          <Field label="工艺与交接说明">
            <Textarea
              rows={5}
              maxLength={2000}
              value={draft.constructionNotes}
              onChange={(event) =>
                update("constructionNotes", event.target.value)
              }
            />
          </Field>
        </div>
      </fieldset>
      <section
        data-tech-chapter="review"
        hidden={chapter !== "review"}
        className={styles.stack}
      >
        <label id={`${chapterId}-review`} className={styles.check}>
          <input
            type="checkbox"
            checked={draft.reviewConfirmed}
            disabled={form.busy || (!data.capabilities.review && !canEdit)}
            onChange={(event) =>
              update("reviewConfirmed", event.target.checked)
            }
          />
          我已人工复核本次资料的视图、材料、尺寸及工艺。
        </label>
        <div className={styles.note}>
          未知尺寸、用量与公差请留空。正式发布需要正背视图、材料、尺寸和配色均完成复核。AI
          建议的尺寸或用量需要替换为已确认资料。
        </div>
      </section>
      <SaveBar
        feedback={feedback?.snapshot}
        busy={form.busy}
        dirty={form.dirty}
        isNew={!existing}
        hint={
          !draft.styleRevisionId
            ? "保存前需关联款式修订"
            : `${readiness.length} 项待复核`
        }
        canEdit={canEdit}
        primary={form.dirty || !existing}
      >
        <Button
          variant={
            (!form.dirty || !canEdit) &&
            !!existing &&
            draft.status !== "PUBLISHED"
              ? "primary"
              : "secondary"
          }
          loading={form.busy}
          feedback={feedback?.snapshot}
          feedbackAction="publish"
          disabled={
            !data.capabilities.review ||
            (!canEdit && !existing) ||
            (canEdit && Boolean(existing) && form.dirty)
          }
          onClick={() => void save(true)}
        >
          复核并发布
        </Button>
        {existing ? (
          <TechPackExportButton
            projectId={projectId}
            revisionId={existing.currentRevision.id}
            disabled={form.dirty || form.busy}
            primary={!form.dirty && draft.status === "PUBLISHED"}
          />
        ) : null}
      </SaveBar>
      {existing ? (
        <GridDetails className={styles.record}>
          <summary>查看和导出历史修订</summary>
          {existing.revisions.map((revision) => (
            <article className={styles.record} key={revision.id}>
              <div className={styles.recordHeader}>
                <strong>
                  r{revision.revision} {revision.payload.name}
                </strong>
                <Badge>
                  {(revision.payload as StudioTechPack).status === "PUBLISHED"
                    ? "已发布"
                    : "草稿"}
                </Badge>
              </div>
              <small>
                {new Date(revision.createdAt).toLocaleString("zh-CN")}
              </small>
              <a
                href={techPackExportUrl(projectId, revision.id)}
                className={styles.link}
                target="_blank"
                rel="noreferrer"
              >
                打开此修订的打印版
              </a>
              {canEdit ? (
                <Button
                  size="small"
                  onClick={() =>
                    setDraft({
                      ...createTechPackDraft(
                        revision.payload as StudioTechPack,
                      ),
                      status: "DRAFT",
                      reviewConfirmed: false,
                    })
                  }
                >
                  以此修订继续编辑
                </Button>
              ) : null}
            </article>
          ))}
        </GridDetails>
      ) : null}
    </form>
  );
}
