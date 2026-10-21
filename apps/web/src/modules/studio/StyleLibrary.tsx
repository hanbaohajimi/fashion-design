"use client";

import { useState } from "react";
import type {
  StudioStyleInput,
  StudioStyleView,
  StudioSummary,
} from "@fashion/shared";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  ImagePreview,
  Input,
  Notice,
  Select,
  Textarea,
} from "../../components/ui";
import { saveStyle } from "./studio-api";
import { AssetPicker, SaveBar } from "./studio-ui";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import styles from "./studio.module.css";

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
  },
) {
  const [draftVersion, setDraftVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<string[]>([]);
  const [adoptedId, setAdoptedId] = useState(props.initialAssetId ?? "");
  const selected = props.data.styles.find((style) => style.id === selectedId);
  const selectStyle = async (id: string | null) => {
    if (await props.beforeChange()) {
      setSelectedId(id);
      setDraftVersion((current) => current + 1);
      setAdoptedId("");
    }
  };
  return (
    <div className={styles.section}>
      <div className={styles.recordHeader}>
        <div>
          <h2>款式档案</h2>
          <p className={styles.muted}>
            让选中的方案成为可持续修订、交接的款式。
          </p>
        </div>
        {props.canEdit ? (
          <Button onClick={() => void selectStyle(null)}>新建款式</Button>
        ) : null}
      </div>
      <div className={styles.summary}>
        <div>
          <strong>{props.data.styles.length}</strong>
          <small>已建立款式</small>
        </div>
        <div>
          <strong>
            {
              props.data.styles.filter((item) => item.status === "APPROVED")
                .length
            }
          </strong>
          <small>已定稿</small>
        </div>
        <div>
          <strong>
            {
              props.data.styles.filter((item) => item.status === "SAMPLING")
                .length
            }
          </strong>
          <small>打样中</small>
        </div>
      </div>
      <details className={styles.record}>
        <summary>比较候选并选款（选择 2–4 张）</summary>
        <AssetPicker
          assets={props.data.assets}
          selected={comparison}
          onChange={setComparison}
          max={4}
          label="候选比较"
        />
        {comparison.length >= 2 ? (
          <div className={styles.compare}>
            {comparison.map((id, index) => {
              const asset = props.data.assets.find((item) => item.id === id);
              return asset ? (
                <article key={id}>
                  <span className={styles.assetImage}>
                    <ImagePreview
                      alt={"候选方案 " + (index + 1)}
                      src={asset.url}
                    />
                  </span>
                  <strong>方案 {index + 1}</strong>
                  <small className={styles.muted}>{id.slice(0, 12)}</small>
                  <Button
                    disabled={!props.canEdit}
                    onClick={() =>
                      void (async () => {
                        if (await props.beforeChange()) {
                          setSelectedId(null);
                          setDraftVersion((current) => current + 1);
                          setAdoptedId(id);
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
      </details>
      <div className={styles.split}>
        <aside className={styles.rail} aria-label="已有款式">
          {props.data.styles.map((style) => (
            <Button
              aria-pressed={selectedId === style.id}
              key={style.id}
              onClick={() => void selectStyle(style.id)}
            >
              <strong>
                {style.code} · {style.name}
              </strong>
              <small>
                {STATUS_LABELS[style.status]} · r
                {style.currentRevision.revision}
              </small>
            </Button>
          ))}
          {!props.data.styles.length ? (
            <p className={styles.muted}>
              还没有款式。选择一张已有候选保存第一款。
            </p>
          ) : null}
        </aside>
        {props.canEdit || selected ? (
          <StyleEditor
            key={
              (selected?.id ?? "new") +
              ":" +
              (selected?.version ?? 0) +
              ":" +
              draftVersion +
              ":" +
              adoptedId
            }
            {...props}
            existing={selected}
            adoptedId={adoptedId}
            onCreated={setSelectedId}
          />
        ) : (
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
  existing,
  adoptedId,
  onCreated,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioStyleView | undefined;
  readonly adoptedId: string;
  readonly onCreated: (id: string) => void;
}) {
  const initial = existing
    ? {
        ...existing.currentRevision.payload,
        status:
          existing.status === "APPROVED"
            ? ("REVIEW" as const)
            : existing.currentRevision.payload.status,
      }
    : { ...blankStyle(), sourceAssetId: adoptedId };
  const form = useStudioForm(initial, onDirty);
  const { draft, setDraft } = form;
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
    let savedId = "";
    if (
      await form.submit(async (key) => {
        const saved = await saveStyle(projectId, payload, key, existing);
        savedId = saved.id;
      })
    ) {
      await onSaved();
      onCreated(savedId);
    }
  };
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className={styles.recordHeader}>
        <h3>{existing ? existing.name : "建立新款式"}</h3>
        {existing ? <Badge>r{existing.currentRevision.revision}</Badge> : null}
      </div>
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
                .filter(([value]) => value !== "APPROVED")
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
        <AssetPicker
          assets={data.assets}
          selected={draft.sourceAssetId ? [draft.sourceAssetId] : []}
          onChange={(ids) => update("sourceAssetId", ids[0] ?? "")}
          label="主设计图（必选）"
        />
        <div className={styles.section}>
          <h3>视图资料</h3>
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
                  <Select
                    value={view.assetId}
                    onChange={(event) =>
                      update(
                        "views",
                        draft.views.map((item, at) =>
                          at === index
                            ? {
                                ...item,
                                assetId: event.target.value,
                                reviewed: false,
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {data.assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.id.slice(0, 12)}
                      </option>
                    ))}
                  </Select>
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
        </div>
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
      <SaveBar
        busy={form.busy}
        dirty={form.dirty || !existing}
        canEdit={canEdit}
      />
      {existing ? (
        <details className={styles.record}>
          <summary>修订历史（{existing.revisions.length}）</summary>
          <div className={styles.history}>
            {existing.revisions.map((revision) => (
              <article key={revision.id}>
                <div className={styles.recordHeader}>
                  <strong>
                    r{revision.revision} · {revision.payload.name}
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
                  {canEdit ? (
                    <Button
                      size="small"
                      onClick={() =>
                        setDraft({
                          ...revision.payload,
                          changeNote:
                            "基于 r" + revision.revision + " 继续修改",
                        })
                      }
                    >
                      以此修订继续
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </form>
  );
}
