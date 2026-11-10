"use client";

import { AssetSelect } from "./studio-ui";
import { GridDetails } from "../../components/GridDetails";

import { useSubmitFeedback } from "../../components/interactions/use-submit-feedback";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为当前修订的设计图与资料；对象切换和历史为次级。保存为主操作，比较在独立弹窗完成。 */

import { useStudioAssetName } from "./studio-object-context";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  StudioStyleInput,
  StudioStyleRevisionView,
  StudioStyleView,
  StudioSummary,
} from "@fashion/shared";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  ImagePreview,
  Input,
  Menu,
  Notice,
  Select,
  Textarea,
} from "../../components/ui";
import { saveStyle } from "./studio-api";
import { AssetPicker, SaveBar } from "./studio-ui";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { ObjectSwitcher, FormSection } from "../../components/workspace-ui";
import styles from "./studio.module.css";
import { StudioEditSection } from "./StudioEditSection";
import { StudioPageHeader } from "./StudioPageHeader";
import { continueStyleRevision, findStyleRevision, mergeSavedStyles } from "./style-revisions";

const STATUS_LABELS: Record<StudioStyleInput["status"], string> = {
  DESIGNING: "设计中",
  REVIEW: "待评审",
  APPROVED: "已定稿",
  SAMPLING: "打样中",
  ARCHIVED: "归档",
};
const blankStyle = (): StudioStyleInput => ({
  name: "",
  code: "",
  category: "",
  season: "",
  description: "",
  sourceAssetId: "",
  views: [],
  status: "DESIGNING",
  changeNote: "",
});

export function StyleLibrary(
  props: StudioPanelProps & {
    readonly data: StudioSummary;
    readonly initialAssetId?: string | undefined;
    readonly initialStyleRevisionId?: string | undefined;
    readonly onSelectionChange?: (revisionId: string | undefined, assetId?: string) => void;
    readonly onStyleSaved?: (style: StudioStyleView) => void;
    readonly onExplore?: (assetId: string) => void;
    readonly onTechPack?: (revisionId: string) => void;
    readonly onRunway?: (revisionId: string) => void;
    readonly onPresentation?: (revisionId: string) => void;
    readonly onWardrobe?: (revisionId: string, assetId: string) => void;
  },
) {
  const feedback = useSubmitFeedback();
  const [saving, setSaving] = useState(false);
  const beforeChange = async () => {
    if (saving) return false;
    const allowed = await props.beforeChange();
    if (allowed) feedback.reset();
    return allowed;
  };
  const assetName = useStudioAssetName();
  const comparisonPicker = useRef<HTMLDetailsElement>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [savedStyles, setSavedStyles] = useState<StudioStyleView[]>([]);
  const availableStyles = mergeSavedStyles(props.data.styles, savedStyles);
  const initialSelection = findStyleRevision(availableStyles, props.initialStyleRevisionId);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelection?.style.id ?? (props.initialAssetId || props.initialStyleRevisionId ? null : (availableStyles[0]?.id ?? null)),
  );
  const [viewedRevisionId, setViewedRevisionId] = useState(props.initialStyleRevisionId);
  const [seed, setSeed] = useState<StudioStyleInput | undefined>();
  const [editingDirty, setEditingDirty] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [refreshError, setRefreshError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparison, setComparison] = useState<string[]>([]);
  const [adoptedId, setAdoptedId] = useState(props.initialAssetId ?? "");
  const revisionSelection = findStyleRevision(availableStyles, viewedRevisionId);
  const selected = viewedRevisionId ? revisionSelection?.style : availableStyles.find((style) => style.id === selectedId);
  const viewed = viewedRevisionId ? revisionSelection?.revision : selected?.currentRevision;
  const initialDraft = seed ?? (adoptedId && viewed && adoptedId !== viewed.payload.sourceAssetId ? continueStyleRevision(viewed, adoptedId) : undefined);
  const historical = Boolean(selected && viewed && viewed.id !== selected.currentRevision.id && !initialDraft);
  const missingRevision = Boolean(viewedRevisionId && !revisionSelection);
  const currentData = { ...props.data, styles: availableStyles };
  const notifyDirty = props.onDirty;
  const onDirty = useCallback((dirty: boolean) => { setEditingDirty(dirty); notifyDirty(dirty); }, [notifyDirty]);
  const selectStyle = async (id: string | null) => {
    if (await beforeChange()) {
      setSelectedId(id);
      setDraftVersion((current) => current + 1);
      setAdoptedId("");
      setSeed(undefined);
      setViewedRevisionId(undefined);
      setSaveNotice("");
      props.onSelectionChange?.(availableStyles.find(style => style.id === id)?.currentRevision.id);
    }
  };
  const selectRevision = async (revision: StudioStyleRevisionView, continueEditing = false) => {
    if (!(await beforeChange())) return;
    setViewedRevisionId(revision.id);
    setSeed(continueEditing ? continueStyleRevision(revision) : undefined);
    setAdoptedId("");
    setDraftVersion(current => current + 1);
    setSaveNotice("");
    props.onSelectionChange?.(revision.id);
  };
  const acceptSaved = (style: StudioStyleView) => {
    setSavedStyles(previous => mergeSavedStyles(previous, [style]));
    setSelectedId(style.id);
    setViewedRevisionId(style.currentRevision.id);
    setSeed(undefined);
    setAdoptedId("");
    setEditingDirty(false);
    setSaveNotice(`「${style.name}」r${style.currentRevision.revision} 已保存，可以继续技术包或商品展示。`);
    props.onStyleSaved?.(style);
    props.onSelectionChange?.(style.currentRevision.id);
    setRefreshError(false);
    void props.onSaved().then(result => setRefreshError(result === false), () => setRefreshError(true));
  };
  return (
    <div className={styles.section}>
      <StudioPageHeader
        objectSwitcher={
          availableStyles.length > 0 ? (
            <ObjectSwitcher
              label="切换款式"
              current={selected?.code ?? "建立新款式"}
            >
              <aside
                className={`${styles.rail} ${styles.styleRail}`}
                aria-label="已有款式"
              >
                {availableStyles.map((style) => (
                  <Button
                    aria-pressed={selected?.id === style.id}
                    key={style.id}
                    onClick={() => void selectStyle(style.id)}
                  >
                    <span className={styles.styleThumbnail}>
                      <ImagePreview
                        retryable={false}
                        src={
                          style.currentRevision.views[0]?.thumbnailUrl ??
                          style.currentRevision.views[0]?.url
                        }
                        alt=""
                      />
                    </span>
                    <strong>
                      {style.code} {style.name}
                    </strong>
                    <small>
                      {STATUS_LABELS[style.status]} r
                      {style.currentRevision.revision}
                    </small>
                  </Button>
                ))}
                {!availableStyles.length ? (
                  <p className={styles.muted}>
                    还没有款式。选择一张已有候选保存第一款。
                  </p>
                ) : null}
              </aside>
            </ObjectSwitcher>
          ) : null
        }
        title={historical ? viewed?.payload.name ?? "款式修订" : selected?.name ?? "建立新款式"}
        type="款式档案"
        description={selected ? "" : "选择主设计图，整理款式资料与视图"}
        guideHasRevision={Boolean(selected)}
        status={
          selected && viewed ? <Badge>{historical ? "历史修订 " : ""}r{historical ? viewed.revision : selected.currentRevision.revision}</Badge> : null
        }
        actions={
          <>
            <Button aria-label="比较候选并选款（选择 2–4 张）" disabled={saving} onClick={() => setComparisonOpen(true)}>
              比较候选
            </Button>
            {props.canEdit ? (
              <Button disabled={saving} onClick={() => void selectStyle(null)}>新建款式</Button>
            ) : null}
          </>
        }
      />
      {saveNotice && !editingDirty ? <Notice tone="success">{saveNotice}</Notice> : null}
      {refreshError ? <Notice tone="warning">款式已经保存，资料列表暂未刷新。当前保存结果仍可继续使用。<Button onClick={() => { void props.onSaved().then(result => setRefreshError(result === false), () => setRefreshError(true)); }}>刷新资料</Button></Notice> : null}
      {missingRevision ? <Notice tone="warning">这份款式修订不存在或已无法访问。请从已有款式中选择，或重新载入资料。{loadError ? <p>重新载入未完成，请稍后重试。</p> : null}<Button onClick={() => { void props.onSaved().then(result => setLoadError(result === false), () => setLoadError(true)); }}>重新载入</Button></Notice> : null}
      {historical && selected && viewed ? <Notice>正在查看 r{viewed.revision}，最新为 r{selected.currentRevision.revision}。后续操作使用当前查看的修订。<Button onClick={() => void selectRevision(selected.currentRevision)}>查看最新修订</Button>{props.canEdit ? <Button onClick={() => void selectRevision(viewed, true)}>以此修订继续</Button> : null}</Notice> : null}
      {initialDraft && viewed ? <Notice>基于 r{viewed.revision} 继续编辑。保存后形成新修订，已保存的历史与交付引用保留。</Notice> : null}
      {comparisonOpen ? (
        <Dialog
          className={styles.dialog}
          label="候选比较"
          onClose={() => setComparisonOpen(false)}
        >
          <div className={styles.progressDialog}>
            <div className={styles.recordHeader}>
              <h2>比较候选并选款</h2>
              <Button onClick={() => setComparisonOpen(false)}>关闭</Button>
            </div>
            <GridDetails
              ref={comparisonPicker}
              className={styles.compareSelection}
              open
            >
              <summary>调整比较对象 已选 {comparison.length} 张</summary>
              <AssetPicker
                assets={props.data.assets}
                selected={comparison}
                onChange={setComparison}
                max={4}
                label="候选比较"
              />
              <Button
                disabled={comparison.length < 2}
                onClick={() => {
                  if (comparisonPicker.current) {
                    comparisonPicker.current.open = false;
                    comparisonPicker.current.querySelector("summary")?.focus();
                  }
                }}
              >
                开始比较
              </Button>
            </GridDetails>
            {comparison.length >= 2 ? (
              <div className={styles.compare}>
                {comparison.map((id, index) => {
                  const asset = props.data.assets.find(
                    (item) => item.id === id,
                  );
                  return asset ? (
                    <article key={id}>
                      <span className={styles.assetImage}>
                        <ImagePreview
                          alt={"候选方案 " + (index + 1)}
                          src={asset.url}
                        />
                      </span>
                      <strong>方案 {index + 1}</strong>
                      <small className={styles.muted}>{assetName(id)}</small>
                      <Button
                        disabled={!props.canEdit}
                        onClick={() =>
                          void (async () => {
                            if (await beforeChange()) {
                              setSelectedId(null);
                              setDraftVersion((current) => current + 1);
                              setAdoptedId(id);
                              setViewedRevisionId(undefined);
                              setSeed(undefined);
                              setSaveNotice("");
                              props.onSelectionChange?.(undefined, id);
                              setComparisonOpen(false);
                            }
                          })()
                        }
                      >
                        采用为新款式
                      </Button>
                    </article>
                  ) : null;
                })}
              </div>
            ) : (
              <p className={styles.muted}>
                至少选择两张即可并排比较。采用理由会作为款式首次修订说明保存。
              </p>
            )}
          </div>
        </Dialog>
      ) : null}
      {selected && viewed ? (
        <div className={styles.styleContinuation}>
          <span>{editingDirty ? "请先保存修改，再继续后续工作。" : `后续工作使用 r${viewed.revision}`}</span>
          <div>
          {!editingDirty && !saving ? <a className={styles.canvasReturn} href={`/${encodeURIComponent(props.projectId)}?assetId=${encodeURIComponent(viewed.payload.sourceAssetId)}&styleRevisionId=${encodeURIComponent(viewed.id)}`}>在白板中继续编辑</a> : null}
          {props.onExplore || props.onTechPack || props.onPresentation || props.canEdit && (props.onRunway || props.onWardrobe) ? <Menu label="继续创作与交付" trigger="继续工作" align="end">
          {props.onExplore ? <Button
            disabled={editingDirty || saving}
            onClick={() =>
              props.onExplore?.(viewed.payload.sourceAssetId)
            }
          >
            以此款式探索色料
          </Button> : null}
          {props.onTechPack ? (
            <Button
              disabled={editingDirty || saving}
              onClick={() => props.onTechPack?.(viewed.id)}
            >
              继续技术包
            </Button>
          ) : null}

          {props.onPresentation ? (
            <Button
              disabled={editingDirty || saving}
              onClick={() =>
                props.onPresentation?.(viewed.id)
              }
            >
              继续商品展示
            </Button>
          ) : null}
          {props.canEdit && props.onRunway ? (
            <Button
              disabled={editingDirty || saving}
              onClick={() => props.onRunway?.(viewed.id)}
            >
              制作服装秀
            </Button>
          ) : null}
          {props.canEdit && props.onWardrobe ? (
            <Button disabled={editingDirty || saving} onClick={() => props.onWardrobe?.(viewed.id, viewed.payload.sourceAssetId)}>
              加入衣架
            </Button>
          ) : null}
          </Menu> : null}
          </div>
        </div>
      ) : null}
      <div className={styles.split}>
        {!missingRevision && (props.canEdit || selected) ? (
          <StyleEditor
            key={
              (selected?.id ?? "new") +
              ":" +
              (selected?.version ?? 0) +
              ":" +
              draftVersion +
              ":" +
              adoptedId +
              ":" +
              (viewed?.id ?? "new")
            }
            {...props}
            data={currentData}
            onDirty={onDirty}
            canEdit={props.canEdit && !historical}
            feedback={feedback}
            beforeChange={beforeChange}
            existing={selected}
            adoptedId={adoptedId}
            viewedRevision={historical ? viewed : undefined}
            initialDraft={initialDraft}
            onCommitted={acceptSaved}
            onBackgroundCommit={props.onStyleSaved}
            onSaving={setSaving}
            onSelectRevision={selectRevision}
            allowContinue={props.canEdit}
          />
        ) : missingRevision ? null : (
          <EmptyState title="款式档案还是空白">
            编辑成员建立款式后，可在这里查看。
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function StyleEditor({
  projectId,
  data,
  canEdit,
  onDirty,
  onSaved,
  beforeChange,
  feedback,
  existing,
  adoptedId,
  viewedRevision,
  initialDraft,
  onCommitted,
  onBackgroundCommit,
  onSaving,
  onSelectRevision,
  allowContinue,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioStyleView | undefined;
  readonly adoptedId: string;
  readonly viewedRevision?: StudioStyleRevisionView | undefined;
  readonly initialDraft?: StudioStyleInput | undefined;
  readonly onCommitted: (style: StudioStyleView) => void;
  readonly onBackgroundCommit?: ((style: StudioStyleView) => void) | undefined;
  readonly onSaving: (saving: boolean) => void;
  readonly onSelectRevision: (revision: StudioStyleRevisionView, continueEditing?: boolean) => Promise<void>;
  readonly allowContinue: boolean;
}) {
  const initial = viewedRevision ? viewedRevision.payload : existing
    ? {
        ...existing.currentRevision.payload,
        status:
          existing.status === "APPROVED"
            ? ("REVIEW" as const)
            : existing.currentRevision.payload.status,
      }
    : { ...blankStyle(), sourceAssetId: adoptedId };
  const form = useStudioForm(initial, onDirty, { feedback, draftKey: existing?.id ?? `new:${adoptedId}`, initialDraft, persist: !viewedRevision });
  useLayoutEffect(() => { onSaving(form.busy); return () => onSaving(false); }, [form.busy, onSaving]);
  const { draft, setDraft } = form;
  const [viewAssetId, setViewAssetId] = useState("");
  const revisionImages = viewedRevision?.views ?? existing?.currentRevision.views;
  const imageUrl = (id: string) => data.assets.find(asset => asset.id === id)?.url ?? revisionImages?.find(view => view.assetId === id)?.url;
  const update = <K extends keyof StudioStyleInput>(
    key: K,
    value: StudioStyleInput[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    const payload = {
      ...draft,
      views: draft.views.length
        ? draft.views
        : draft.sourceAssetId
          ? [
              {
                kind: "front" as const,
                assetId: draft.sourceAssetId,
                label: "正面设计",
                reviewed: false,
              },
            ]
          : [],
    };
    if (!canEdit) return;
    let savedStyle: StudioStyleView | undefined;
    if (
      await form.submit(async (key, recovery) => {
        savedStyle = await saveStyle(projectId, payload, key, existing, recovery);
      })
    ) {
      if (savedStyle) {
        if (form.isMounted()) onCommitted(savedStyle);
        else onBackgroundCommit?.(savedStyle);
      }
    }
  };
  return (
    <form
      className={`${styles.form} ${styles.styleForm}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {form.error ? (
        <Notice tone="error">
          {form.error}
          {form.conflict ? (
            <Button
              size="small"
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
      {form.saved ? <Notice tone="success">款式修订已保存。</Notice> : null}
      <div className={styles.styleVisuals}>
        {draft.sourceAssetId ? (
          <span className={styles.assetImage}>
            <ImagePreview
              src={imageUrl(viewAssetId || draft.sourceAssetId)}
              alt="当前款式主设计图"
            />
          </span>
        ) : (
          <div className={styles.workIntro}>
            <h3>从主设计图建立款式</h3>
            <p>
              选择一张真实图片，再补充款号、名称和品类。候选比较不会改变已保存的修订。
            </p>
          </div>
        )}
        <AssetPicker
          assets={data.assets}
          selected={draft.sourceAssetId ? [draft.sourceAssetId] : []}
          disabled={!canEdit || form.busy}
          onChange={(ids) => {
            const assetId = ids[0] ?? "";
            setDraft(current => ({ ...current, sourceAssetId: assetId, views: assetId ? current.views.map(view => view.assetId === current.sourceAssetId ? { ...view, assetId, reviewed: false } : view) : current.views }));
            setViewAssetId("");
          }}
          label="主设计图（必选）"
          selectionPreview={false}
        />
        <div>
          <nav className={styles.viewStrip} aria-label="款式视图">
            {[
              ...new Set([
                draft.sourceAssetId,
                ...draft.views.map((view) => view.assetId),
              ]),
            ]
              .filter(Boolean)
              .map((id, index) => (
                <Button
                  key={id}
                  aria-label={`查看款式视图 ${index + 1}`}
                  aria-pressed={(viewAssetId || draft.sourceAssetId) === id}
                  onClick={() => setViewAssetId(id)}
                >
                  <ImagePreview
                    retryable={false}
                    src={imageUrl(id)}
                    alt={`款式视图 ${index + 1}`}
                  />
                </Button>
              ))}
          </nav>
          <p className={styles.documentSummary}>
            {[
              draft.code,
              draft.category,
              draft.season,
              STATUS_LABELS[viewedRevision?.payload.status ?? existing?.status ?? draft.status],
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
          <p className={styles.documentSummary}>
            {draft.description || "尚未填写设计说明"}
          </p>
        </div>
      </div>
      <StudioEditSection
        persistent
        title={canEdit ? "编辑款式资料" : "款式资料"}
        summary={
          form.dirty
            ? "有未保存的修改"
            : `${draft.name || "新款式"} ${draft.views.length} 个视图`
        }
        defaultOpen={!existing}
        save={canEdit}
        busy={form.busy}
        error={form.error}
      >
        <fieldset disabled={!canEdit || form.busy} className={styles.form}>
          <div className={styles.formGrid}>
            <Field label="款号">
              <Input
                value={draft.code}
                onChange={(event) => update("code", event.target.value)}
                required
                maxLength={60}
                placeholder="例如：AW-026-JK01"
              />
            </Field>
            <Field label="款式名称">
              <Input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                required
                maxLength={120}
              />
            </Field>
            <Field label="品类">
              <Input
                value={draft.category}
                onChange={(event) => update("category", event.target.value)}
                required
                maxLength={120}
                placeholder="例如：夹克"
              />
            </Field>
            <Field label="季节">
              <Input
                value={draft.season}
                onChange={(event) => update("season", event.target.value)}
                maxLength={120}
                placeholder="例如：2027 春夏"
              />
            </Field>
            <Field
              label="状态"
              hint={
                existing?.status === "APPROVED"
                  ? "已定稿款式的后续修订需要重新评审。"
                  : "审批状态由团队评审产生。"
              }
            >
              <Select
                value={draft.status}
                onChange={(event) =>
                  update(
                    "status",
                    event.target.value as StudioStyleInput["status"],
                  )
                }
              >
                {Object.entries(STATUS_LABELS)
                  .filter(([value]) => value !== "APPROVED" || viewedRevision?.payload.status === "APPROVED")
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Field label="设计说明">
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(event) => update("description", event.target.value)}
              maxLength={2000}
            />
          </Field>

          <FormSection
            title="视图资料"
            summary={`${draft.views.length} 个视图`}
          >
            {draft.views.map((view, index) => (
              <div className={styles.record} key={index}>
                <div className={styles.formGrid}>
                  <Field label={"视图 " + (index + 1)}>
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
                  <Field label="说明">
                    <Input
                      value={view.label}
                      onChange={(event) =>
                        update(
                          "views",
                          draft.views.map((item, at) =>
                            at === index
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="关联图片">
                    <AssetSelect
                      value={view.assetId}
                      onValueChange={(assetId) =>
                        update(
                          "views",
                          draft.views.map((item, at) =>
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
                     assets={data.assets} />
                  </Field>
                </div>
                <Button
                  size="small"
                  onClick={() =>
                    update(
                      "views",
                      draft.views.filter((_, at) => at !== index),
                    )
                  }
                >
                  移除此视图
                </Button>
              </div>
            ))}
            <Button
              disabled={!data.assets.length || draft.views.length >= 20}
              onClick={() =>
                update("views", [
                  ...draft.views,
                  {
                    kind: "detail",
                    assetId: draft.sourceAssetId || data.assets[0]?.id || "",
                    label: "",
                    reviewed: false,
                  },
                ])
              }
            >
              添加视图
            </Button>
          </FormSection>
          <Field
            label={existing ? "本次修改说明" : "采用理由"}
            hint="记录为什么选择这个方案，以及本次修改了什么。"
          >
            <Textarea
              value={draft.changeNote}
              onChange={(event) => update("changeNote", event.target.value)}
              rows={3}
              maxLength={2000}
            />
          </Field>
        </fieldset>
      </StudioEditSection>
      {canEdit ? <SaveBar
        feedback={feedback?.snapshot}
        interaction="spring"
        busy={form.busy}
        dirty={form.dirty}
        isNew={!existing}
        canEdit={canEdit}
      /> : null}
      {existing ? (
        <GridDetails className={styles.record}>
          <summary>修订历史（{existing.revisions.length}）</summary>
          <div className={styles.history}>
            {existing.revisions.map((revision) => (
              <article key={revision.id}>
                <div className={styles.recordHeader}>
                  <strong>
                    r{revision.revision} {revision.payload.name}
                  </strong>
                  <Badge>{STATUS_LABELS[revision.payload.status]}</Badge>
                </div>
                <p>{revision.payload.changeNote || "未填写修改说明"}</p>
                <small className={styles.muted}>
                  {new Date(revision.createdAt).toLocaleString("zh-CN")}
                </small>
                <div className={styles.toolbar}>
                  {revision.views.map((view, index) => (
                    <a
                      href={view.url}
                      key={index}
                      className={styles.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {view.label || view.kind}
                    </a>
                  ))}
                  <Button size="small" aria-pressed={viewedRevision?.id === revision.id || !viewedRevision && existing.currentRevision.id === revision.id} onClick={() => void onSelectRevision(revision)}>查看 r{revision.revision}</Button>
                  {allowContinue ? (
                    <Button
                      size="small"
                      onClick={() => void onSelectRevision(revision, true)}
                    >
                      以此修订继续
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </GridDetails>
      ) : null}
    </form>
  );
}
