"use client";

import { useId, useRef, useState } from "react";
import {
  studioPresentationSchema,
  type StudioDocumentView,
  type StudioSummary,
} from "@fashion/shared";
import {
  Badge,
  Button,
  Field,
  Input,
  ImagePreview,
  Notice,
  Select,
  Textarea,
  SegmentedControl,
} from "../../components/ui";
import { revealInvalidField } from "../../components/workspace-ui";
import { saveStudioDocument } from "./studio-api";
import { studioAssetNames } from "./studio-object-context";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { TechPackExportButton } from "./TechPackExportButton";
import {
  PresentationGallery,
  PresentationPreview,
} from "./PresentationGallery";
import styles from "./presentation-sets.module.css";

type Presentation = (typeof studioPresentationSchema)["_output"];
const KIND_LABELS = {
  front: "正面",
  back: "背面",
  detail: "细节",
  scene: "场景",
};
const CHANNEL_LABELS = {
  marketplace: "商品详情页",
  social: "社交媒体",
  lookbook: "系列 Lookbook",
};
type Props = StudioPanelProps & {
  readonly data: StudioSummary;
  readonly onGenerate: () => void;
  readonly onOpenStyles?: () => void;
};

export function PresentationSets(props: Props) {
  const [id, setId] = useState<string | null>(
    props.data.presentationSets[0]?.id ?? null,
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const existing = props.data.presentationSets.find((item) => item.id === id);
  const changeObject = async (next: string | null) => {
    if (!(await props.beforeChange())) return;
    setId(next);
    if (!next) setDraftVersion((current) => current + 1);
  };
  return (
    <PresentationForm
      key={`${existing?.id ?? "new"}:${existing?.version ?? 0}:${draftVersion}`}
      {...props}
      existing={existing}
      onCreated={setId}
      onChangeObject={(next) => void changeObject(next)}
    />
  );
}

function PresentationForm({
  data,
  projectId,
  canEdit,
  onDirty,
  onSaved,
  beforeChange,
  onGenerate,
  onOpenStyles,
  existing,
  onCreated,
  onChangeObject,
}: Props & {
  readonly existing: StudioDocumentView | undefined;
  readonly onCreated: (id: string) => void;
  readonly onChangeObject: (id: string | null) => void;
}) {
  const initial: Presentation = existing
    ? studioPresentationSchema.parse(existing.currentRevision.payload)
    : {
        name: "",
        styleRevisionId: data.styles[0]?.currentRevision.id ?? "",
        status: "DRAFT",
        channel: "marketplace",
        items: [],
        notes: "",
      };
  const form = useStudioForm(initial, onDirty);
  const { draft, setDraft } = form;
  const errorRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const [view, setView] = useState<"organize" | "review">("organize");
  const [selectedAssetId, setSelectedAssetId] = useState(
    initial.items[0]?.assetId ?? "",
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const currentAssetId = draft.items.some(
    (item) => item.assetId === selectedAssetId,
  )
    ? selectedAssetId
    : draft.items[0]?.assetId;
  const names = studioAssetNames(data);
  const assetName = (id: string) =>
    names.get(id) ??
    (data.assets.some((asset) => asset.id === id)
      ? `设计图片 ${data.assets.findIndex((asset) => asset.id === id) + 1}`
      : "已选图片");
  const asset = (id: string) => data.assets.find((item) => item.id === id);
  const disabled = !canEdit || form.busy;
  const reviewed = draft.items.filter((item) => item.reviewed).length;
  const exportPrimary = Boolean(
    existing && !form.dirty && draft.status === "READY",
  );
  const completePrimary = Boolean(
    existing && !form.dirty && draft.status !== "READY",
  );
  const boundStyle = data.styles.find(
    (style) =>
      style.currentRevision.id === draft.styleRevisionId ||
      style.revisions.some((revision) => revision.id === draft.styleRevisionId),
  );
  const boundRevision =
    boundStyle?.currentRevision.id === draft.styleRevisionId
      ? boundStyle.currentRevision
      : boundStyle?.revisions.find(
          (revision) => revision.id === draft.styleRevisionId,
        );
  const missing = [
    !draft.name.trim() && "展示包名称",
    !draft.styleRevisionId && "关联款式",
    !draft.items.length && "展示图片",
  ].filter(Boolean);
  const saveState = form.busy
    ? "正在保存…"
    : !canEdit
      ? "只读资料"
      : form.dirty
        ? "有未保存的修改"
        : !existing
          ? "新展示包尚未保存"
          : "已保存";
  const update = <K extends keyof Presentation>(
    key: K,
    value: Presentation[K],
  ) => setDraft((current) => ({ ...current, [key]: value, status: "DRAFT" }));
  const updateItem = (
    index: number,
    patch: Partial<Presentation["items"][number]>,
  ) =>
    update(
      "items",
      draft.items.map((item, at) =>
        at === index ? { ...item, ...patch } : item,
      ),
    );
  const focusError = () =>
    requestAnimationFrame(() => errorRef.current?.focus());
  const save = async (ready = false) => {
    if (disabled) return;
    const parsed = studioPresentationSchema.safeParse({
      ...draft,
      status: ready ? "READY" : "DRAFT",
    });
    if (!parsed.success) {
      form.setError(
        missing.length
          ? `保存前还需补充：${missing.join("、")}。`
          : (parsed.error.issues[0]?.message ?? "请检查展示资料"),
      );
      const itemIndex = parsed.error.issues.find(
        (issue) => issue.path[0] === "items",
      )?.path[1];
      if (typeof itemIndex === "number") {
        setSelectedAssetId(draft.items[itemIndex]?.assetId ?? "");
        setView("review");
      } else if (
        !missing.length &&
        ready &&
        draft.items.some((item) => !item.reviewed)
      ) {
        setSelectedAssetId(
          draft.items.find((item) => !item.reviewed)?.assetId ?? "",
        );
        setView("review");
      }
      focusError();
      return;
    }
    let savedId = "";
    if (
      await form.submit(async (key) => {
        const saved = await saveStudioDocument(
          projectId,
          { type: "PRESENTATION_SET", payload: parsed.data },
          key + (ready ? "-ready" : "-draft"),
          existing,
        );
        savedId = saved.id;
      })
    ) {
      await onSaved();
      onCreated(savedId);
    } else focusError();
  };

  return (
    <form
      className={styles.workspace}
      aria-label="商品展示包工作区"
      onInvalidCapture={(event) =>
        revealInvalidField(event, () => {
          const id = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-presentation-asset]",
          )?.dataset.presentationAsset;
          if (id) {
            setSelectedAssetId(id);
            setView("review");
          }
        })
      }
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.titleLine}>
            <h2>{draft.name || "新展示包"}</h2>
            <Badge tone={draft.status === "READY" ? "success" : "neutral"}>
              {draft.status === "READY" ? "已核对" : "草稿"}
            </Badge>
          </div>
          <p>
            商品展示包<span aria-hidden="true"> · </span>
            {CHANNEL_LABELS[draft.channel]}
            {existing
              ? ` · 已保存修订 ${existing.currentRevision.revision}`
              : ""}
          </p>
        </div>
        <div className={styles.headerActions}>
          {data.presentationSets.length ? (
            <Select
              aria-label="切换展示包"
              value={existing?.id ?? ""}
              disabled={form.busy}
              onChange={(event) => onChangeObject(event.target.value || null)}
            >
              <option value="">新展示包</option>
              {data.presentationSets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.currentRevision.payload.name} · 修订 {item.version}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => onChangeObject(null)}
          >
            新建展示包
          </Button>
        </div>
      </header>
      {form.error ? (
        <div ref={errorRef} tabIndex={-1} className={styles.error}>
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
      <div className={styles.layout}>
        <section className={styles.content} aria-label="展示素材工作区">
          <div className={styles.workHeader}>
            <SegmentedControl
              label="展示工作视图"
              value={view}
              onChange={setView}
              options={[
                { value: "organize", label: "整理素材" },
                { value: "review", label: "逐图核对" },
              ]}
            />
            <p className={styles.count} aria-live="polite">
              已选 {draft.items.length}/12<span aria-hidden="true"> · </span>
              {draft.items.length
                ? `已核对 ${reviewed}/${draft.items.length}`
                : "待选图"}
            </p>
          </div>
          <section
            className={styles.organize}
            hidden={view !== "organize"}
            aria-label="整理素材"
          >
            <div className={styles.sectionIntro}>
              <div>
                <h3>挑选本次展示的图片</h3>
                <p>按加入顺序保存；取消后重新加入会排在末尾。</p>
              </div>
              <div className={styles.generate}>
                <Button disabled={disabled} onClick={onGenerate}>
                  生成展示候选
                </Button>
                <span>进入实验设置，确认后才生成</span>
              </div>
            </div>
            <PresentationGallery
              assets={data.assets}
              items={draft.items}
              assetName={assetName}
              disabled={disabled}
              onPreview={setPreviewId}
              onToggle={(id) => {
                if (draft.items.some((item) => item.assetId === id))
                  update(
                    "items",
                    draft.items.filter((item) => item.assetId !== id),
                  );
                else if (draft.items.length < 12)
                  update("items", [
                    ...draft.items,
                    { assetId: id, kind: "detail", label: "", reviewed: false },
                  ]);
              }}
            />
            {draft.items.length ? (
              <div className={styles.continueRow}>
                <p>
                  {reviewed === draft.items.length
                    ? "全部图片已核对，可检查资料并保存。"
                    : "选好图片后，逐张检查视图、说明与服装细节。"}
                </p>
                <Button onClick={() => setView("review")}>开始逐图核对</Button>
              </div>
            ) : null}
          </section>
          <section hidden={view !== "review"} aria-label="逐图核对">
            {!draft.items.length ? (
              <div className={styles.empty}>
                <h3>先选入需要展示的图片</h3>
                <p>选入后，可逐张填写说明并人工核对。</p>
                <Button onClick={() => setView("organize")}>
                  返回整理素材
                </Button>
              </div>
            ) : (
              <>
                <nav className={styles.reviewStrip} aria-label="展示图片切换">
                  {draft.items.map((item, index) => (
                    <button
                      type="button"
                      key={item.assetId}
                      aria-label={`图片 ${index + 1} · ${item.reviewed ? "已复核" : "待复核"}`}
                      aria-current={
                        currentAssetId === item.assetId ? "true" : undefined
                      }
                      onClick={() => setSelectedAssetId(item.assetId)}
                    >
                      <ImagePreview
                        retryable={false}
                        src={
                          asset(item.assetId)?.thumbnailUrl ??
                          asset(item.assetId)?.url
                        }
                        alt={assetName(item.assetId)}
                      />
                      <span>
                        {index + 1} · {item.reviewed ? "已核对" : "待核对"}
                      </span>
                    </button>
                  ))}
                </nav>
                {draft.items.map((item, index) => (
                  <article
                    key={item.assetId}
                    className={styles.reviewItem}
                    data-presentation-asset={item.assetId}
                    hidden={currentAssetId !== item.assetId}
                  >
                    <div className={styles.reviewHeading}>
                      <h3>{assetName(item.assetId)}</h3>
                      <Button
                        variant="ghost"
                        onClick={() => setPreviewId(item.assetId)}
                      >
                        查看大图
                      </Button>
                    </div>
                    <div className={styles.reviewImage}>
                      <ImagePreview
                        src={asset(item.assetId)?.url}
                        alt={`展示图片 ${index + 1}`}
                      />
                    </div>
                    <fieldset
                      disabled={disabled}
                      className={styles.reviewFields}
                    >
                      <Field label={`图片 ${index + 1} 视图`}>
                        <Select
                          value={item.kind}
                          onChange={(event) =>
                            updateItem(index, {
                              kind: event.target.value as typeof item.kind,
                              reviewed: false,
                            })
                          }
                        >
                          {Object.entries(KIND_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={`图片 ${index + 1} 说明`}>
                        <Input
                          required
                          maxLength={120}
                          value={item.label}
                          onChange={(event) =>
                            updateItem(index, {
                              label: event.target.value,
                              reviewed: false,
                            })
                          }
                        />
                      </Field>
                      <label className={styles.reviewCheck}>
                        <input
                          type="checkbox"
                          checked={item.reviewed}
                          onChange={(event) =>
                            updateItem(index, {
                              reviewed: event.target.checked,
                            })
                          }
                        />
                        已人工核对图片 {index + 1} 的服装结构、色彩与展示内容
                      </label>
                    </fieldset>
                    <div className={styles.reviewNext}>
                      <span>当前为展示顺序第 {index + 1} 张</span>
                      <Button
                        disabled={draft.items.length < 2}
                        onClick={() =>
                          setSelectedAssetId(
                            draft.items[(index + 1) % draft.items.length]
                              ?.assetId ?? "",
                          )
                        }
                      >
                        下一张
                      </Button>
                    </div>
                  </article>
                ))}
              </>
            )}
          </section>
          <p className={styles.guidance}>
            展示图片只用于视觉表达。请检查生成图是否保留原款细节；图片不能验证真实尺寸、材质性能或合体性。标记已核对后仍需按实际渠道规范使用。
          </p>
        </section>
        <aside className={styles.settings} aria-label="展示包资料">
          <section className={styles.settingsGroup}>
            <h3>关联款式</h3>
            {boundRevision ? (
              <p className={styles.boundStyle}>
                <strong>{boundRevision.payload.name}</strong>
                <span>
                  {boundStyle?.code} · 修订 {boundRevision.revision}
                </span>
              </p>
            ) : null}
            <Field label="采用款式修订">
              <Select
                id={`${uid}-style`}
                required
                disabled={disabled}
                value={draft.styleRevisionId}
                onChange={(event) =>
                  update("styleRevisionId", event.target.value)
                }
              >
                <option value="">选择已保存的款式修订</option>
                {data.styles.flatMap((style) =>
                  style.revisions.map((revision) => (
                    <option key={revision.id} value={revision.id}>
                      {style.code} · {revision.payload.name} · 修订{" "}
                      {revision.revision}
                    </option>
                  )),
                )}
              </Select>
            </Field>
            {!boundRevision ? (
              <div className={styles.prerequisite}>
                <strong>保存前需关联款式修订</strong>
                <p>
                  {data.styles.length
                    ? "请选择对应修订。可以先查看、选择图片。"
                    : "项目中还没有已保存的款式。可以先整理图片，保存展示包前需到款式档案建立修订。"}
                </p>
                {onOpenStyles ? (
                  <Button
                    variant="ghost"
                    onClick={onOpenStyles}
                    disabled={form.busy}
                  >
                    前往款式档案
                  </Button>
                ) : (
                  <a
                    href={`/${encodeURIComponent(projectId)}/studio?tab=styles`}
                  >
                    前往款式档案
                  </a>
                )}
              </div>
            ) : null}
          </section>
          <fieldset className={styles.settingsGroup} disabled={disabled}>
            <legend>展示信息</legend>
            <Field label="展示包名称">
              <Input
                id={`${uid}-name`}
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>
            <Field label="使用渠道">
              <Select
                value={draft.channel}
                onChange={(event) =>
                  update(
                    "channel",
                    event.target.value as Presentation["channel"],
                  )
                }
              >
                {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="展示说明">
              <Textarea
                rows={4}
                maxLength={2000}
                value={draft.notes}
                onChange={(event) => update("notes", event.target.value)}
              />
            </Field>
          </fieldset>
        </aside>
      </div>
      <footer className={styles.actionBar}>
        <div className={styles.actionStatus}>
          <strong role="status">{saveState}</strong>
          <span>
            {missing.length
              ? `保存前还缺：${missing.join("、")}`
              : reviewed < draft.items.length
                ? `还需核对 ${draft.items.length - reviewed} 张图片；可先保存草稿。`
                : "图片已逐张核对；完成操作会保存为已核对修订。"}
          </span>
        </div>
        <div className={styles.actionButtons}>
          <Button
            variant={completePrimary ? "primary" : "secondary"}
            disabled={disabled}
            loading={form.busy}
            onClick={() => void save(true)}
          >
            核对并完成展示包
          </Button>
          <Button
            type="submit"
            variant={
              !exportPrimary && !completePrimary ? "primary" : "secondary"
            }
            disabled={disabled || (!form.dirty && !!existing)}
            loading={form.busy}
          >
            保存修订
          </Button>
          {existing ? (
            <TechPackExportButton
              projectId={projectId}
              revisionId={existing.currentRevision.id}
              sourceType="presentation_set"
              primary={exportPrimary}
              disabled={form.dirty || form.busy}
            />
          ) : null}
        </div>
      </footer>
      {existing ? (
        <section className={styles.history} aria-label="已保存的展示素材">
          <h3>已保存的展示素材</h3>
          <p>以下下载与历史记录来自已保存修订，不包含当前未保存修改。</p>
          <div className={styles.downloads}>
            {(existing.currentRevision.payload as Presentation).items.map(
              (item, index) => (
                <a
                  key={item.assetId}
                  href={`/api/design-assets/${encodeURIComponent(item.assetId)}/content`}
                  download
                >{`下载图片 ${index + 1} · ${KIND_LABELS[item.kind]}`}</a>
              ),
            )}
          </div>
          <details>
            <summary>展示包修订历史</summary>
            {existing.revisions.map((revision) => (
              <article key={revision.id} className={styles.historyRow}>
                <div>
                  <strong>
                    修订 {revision.revision} · {revision.payload.name}
                  </strong>
                  <p>{new Date(revision.createdAt).toLocaleString("zh-CN")}</p>
                </div>
                <TechPackExportButton
                  projectId={projectId}
                  revisionId={revision.id}
                  sourceType="presentation_set"
                />
              </article>
            ))}
          </details>
        </section>
      ) : null}
      {previewId ? (
        <PresentationPreview
          name={assetName(previewId)}
          src={asset(previewId)?.url}
          onClose={() => setPreviewId(null)}
        />
      ) : null}
    </form>
  );
}
