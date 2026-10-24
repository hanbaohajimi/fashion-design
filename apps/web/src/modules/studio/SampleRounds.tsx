"use client";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为当前轮次照片、锚点与问题；轮次切换和历史为次级。保存为主操作，照片坐标保持原值。 */

import { useState } from "react";
import type {
  StudioDocumentInput,
  StudioDocumentView,
  StudioSummary,
} from "@fashion/shared";
import {
  Badge,
  Button,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
  UploadInput,
} from "../../components/ui";
import {
  completeUpload,
  putOriginal,
  signImageUpload,
  validateImage,
  waitForThumbnail,
} from "../board/file-upload-api";
import { importDesignAsset } from "../board/generation/collection-api";
import { saveStudioDocument } from "./studio-api";
import { AssetPicker, SaveBar, type StudioAsset } from "./studio-ui";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { AssetAnchor } from "./AssetAnchor";
import styles from "./studio.module.css";

type Sample = Extract<StudioDocumentInput, { type: "SAMPLE_ROUND" }>["payload"];
const categories = {
  FIT: "版型",
  COLOR: "颜色",
  FABRIC: "面料",
  CONSTRUCTION: "工艺",
  MEASUREMENT: "尺寸",
  TRIM: "辅料",
  PRINT: "图案位置",
};
const states = {
  OPEN: "待处理",
  FIXED: "已修改，待复查",
  VERIFIED: "已复核关闭",
};

export function SampleRounds(
  props: StudioPanelProps & { readonly data: StudioSummary },
) {
  const [id, setId] = useState<string | null>(
    props.data.samples[0]?.id ?? null,
  );
  const [draftVersion, setDraftVersion] = useState(0);
  const [seed, setSeed] = useState<Sample | null>(null);
  const existing = props.data.samples.find((item) => item.id === id);
  const nextRound = async (payload: Sample) => {
    if (!(await props.beforeChange())) return;
    setId(null);
    setDraftVersion((current) => current + 1);
    setSeed({
      ...payload,
      name:
        payload.name.replace(/ · 第 \d+ 轮$/, "") +
        " · 第 " +
        (payload.round + 1) +
        " 轮",
      round: payload.round + 1,
      issues: payload.issues
        .filter((issue) => issue.status !== "VERIFIED")
        .map((issue) => ({
          ...issue,
          id: crypto.randomUUID(),
          status: "OPEN",
        })),
      notes: "承接第 " + payload.round + " 轮未关闭问题，逐项重新定位和复查。",
    });
  };
  return (
    <div className={styles.section}>
      <div className={styles.recordHeader}>
        <div>
          <h2>样衣反馈</h2>
          <p className={styles.muted}>
            问题绑定照片、锚点与技术包修订；修改完成后继续复核。
          </p>
        </div>
        <Button
          disabled={!props.canEdit}
          onClick={() =>
            void (async () => {
              if (await props.beforeChange()) {
                setId(null);
                setDraftVersion((current) => current + 1);
                setSeed(null);
              }
            })()
          }
        >
          建立样衣轮次
        </Button>
      </div>
      <div className={styles.split}>
        {props.data.samples.length > 1 ? (
          <details className={styles.objectChooser}>
            <summary>
              切换资料 · {existing?.currentRevision.payload.name ?? "新建资料"}
            </summary>
            <aside className={styles.rail}>
              {props.data.samples.map((item) => {
                const sample = item.currentRevision.payload as Sample;
                return (
                  <Button
                    key={item.id}
                    aria-pressed={id === item.id}
                    onClick={() =>
                      void (async () => {
                        if (await props.beforeChange()) {
                          setId(item.id);
                          setSeed(null);
                        }
                      })()
                    }
                  >
                    <strong>{sample.name}</strong>
                    <small>
                      第 {sample.round} 轮 ·{" "}
                      {
                        sample.issues.filter(
                          (issue) => issue.status !== "VERIFIED",
                        ).length
                      }{" "}
                      个待复核问题
                    </small>
                  </Button>
                );
              })}
            </aside>
          </details>
        ) : null}
        <SampleEditor
          key={
            (existing?.id ?? "new") +
            ":" +
            (existing?.version ?? 0) +
            ":" +
            draftVersion +
            ":" +
            (seed?.round ?? 0)
          }
          {...props}
          existing={existing}
          seed={seed}
          onCreated={(nextId) => {
            setId(nextId);
            setSeed(null);
          }}
          onNextRound={nextRound}
        />
      </div>
    </div>
  );
}

function SampleEditor({
  projectId,
  data,
  existing,
  canEdit,
  onDirty,
  onSaved,
  beforeChange,
  onCreated,
  seed,
  onNextRound,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioDocumentView | undefined;
  readonly seed: Sample | null;
  readonly onCreated: (id: string) => void;
  readonly onNextRound: (payload: Sample) => Promise<void>;
}) {
  const initial: Sample = existing
    ? (existing.currentRevision.payload as Sample)
    : (seed ?? {
        name: "",
        techPackRevisionId: data.techPacks[0]?.currentRevision.id ?? "",
        round: 1,
        photoAssetIds: [],
        issues: [],
        notes: "",
      });
  const form = useStudioForm(initial, onDirty);
  const { draft, setDraft } = form;
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<StudioAsset[]>([]);
  const assets = [
    ...data.assets,
    ...uploaded.filter(
      (asset) => !data.assets.some((item) => item.id === asset.id),
    ),
  ];
  const update = <K extends keyof Sample>(key: K, value: Sample[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateIssue = (
    index: number,
    patch: Partial<Sample["issues"][number]>,
  ) =>
    update(
      "issues",
      draft.issues.map((issue, at) =>
        at === index ? { ...issue, ...patch } : issue,
      ),
    );
  const save = async () => {
    let id = "";
    if (
      await form.submit(async (key) => {
        const result = await saveStudioDocument(
          projectId,
          { type: "SAMPLE_ROUND", payload: draft },
          key,
          existing,
        );
        id = result.id;
      })
    ) {
      await onSaved();
      onCreated(id);
    }
  };
  const verifyFixed = async () => {
    if (!existing) return;
    const payload = {
      ...draft,
      issues: draft.issues.map((issue) =>
        issue.status === "FIXED"
          ? { ...issue, status: "VERIFIED" as const }
          : issue,
      ),
    };
    let id = "";
    if (
      await form.submit(async (key) => {
        const result = await saveStudioDocument(
          projectId,
          { type: "SAMPLE_ROUND", payload },
          key + "-verify",
          existing,
        );
        id = result.id;
      })
    ) {
      await onSaved();
      onCreated(id);
    }
  };
  const upload = async (file: File) => {
    const invalid = validateImage(file);
    if (invalid) {
      form.setError(invalid);
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
      setUploaded((items) => [
        ...items,
        {
          id: asset.id,
          url:
            "/api/design-assets/" + encodeURIComponent(asset.id) + "/content",
          thumbnailUrl: ready.thumbnail256Url,
        },
      ]);
      setDraft((current) => ({
        ...current,
        photoAssetIds: [...current.photoAssetIds, asset.id],
      }));
      await onSaved();
    } catch (cause) {
      form.setError(
        cause instanceof Error ? cause.message : "样衣照片上传失败",
      );
    } finally {
      setUploading(false);
    }
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
      <fieldset
        className={styles.form}
        disabled={!canEdit || form.busy || uploading}
      >
        <div className={styles.formGrid}>
          <Field label="轮次名称">
            <Input
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field label="打样轮次">
            <Input
              required
              disabled={!!existing}
              value={draft.round}
              type="number"
              min={1}
              max={1000}
              onChange={(event) => update("round", Number(event.target.value))}
            />
          </Field>
        </div>
        <Field label="对应技术包修订">
          <Select
            required
            disabled={!!existing}
            value={draft.techPackRevisionId}
            onChange={(event) =>
              update("techPackRevisionId", event.target.value)
            }
          >
            <option value="">选择技术包修订</option>
            {data.techPacks.flatMap((pack) =>
              pack.revisions.map((revision) => (
                <option key={revision.id} value={revision.id}>
                  {revision.payload.name} · r{revision.revision}
                </option>
              )),
            )}
          </Select>
        </Field>
        <Field label="上传样衣照片">
          <UploadInput
            label="上传样衣照片"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            disabled={draft.photoAssetIds.length >= 30}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </Field>
        <AssetPicker
          assets={assets}
          selected={draft.photoAssetIds}
          max={30}
          label="本轮照片"
          onChange={(ids) => {
            const removed = draft.photoAssetIds.filter(
              (id) => !ids.includes(id),
            );
            if (draft.issues.some((issue) => removed.includes(issue.assetId))) {
              form.setError(
                "这张照片上仍有问题记录。请先修改问题的关联照片或移除问题。",
              );
              return;
            }
            update("photoAssetIds", ids);
          }}
        />
        <section className={styles.section}>
          <div className={styles.recordHeader}>
            <h3>问题记录</h3>
            <Button
              disabled={
                !draft.photoAssetIds.length || draft.issues.length >= 100
              }
              onClick={() =>
                update("issues", [
                  ...draft.issues,
                  {
                    id: crypto.randomUUID(),
                    assetId: draft.photoAssetIds[0] ?? "",
                    x: 0.5,
                    y: 0.5,
                    category: "FIT",
                    text: "",
                    status: "OPEN",
                    resolution: "",
                  },
                ])
              }
            >
              添加问题
            </Button>
          </div>
          {draft.issues.map((issue, index) => (
            <fieldset
              className={`${styles.record} ${styles.issueRecord}`}
              disabled={
                issue.status === "VERIFIED" && !data.capabilities.review
              }
              key={issue.id}
            >
              <div className={styles.recordHeader}>
                <strong>问题 {index + 1}</strong>
                <Badge
                  tone={issue.status === "VERIFIED" ? "success" : "warning"}
                >
                  {states[issue.status]}
                </Badge>
              </div>
              <div className={styles.formGrid}>
                <Field label="关联样衣照片">
                  <Select
                    value={issue.assetId}
                    onChange={(event) =>
                      updateIssue(index, {
                        assetId: event.target.value,
                        x: 0.5,
                        y: 0.5,
                        status: "OPEN",
                      })
                    }
                  >
                    {draft.photoAssetIds.map((id) => (
                      <option key={id} value={id}>
                        {id.slice(0, 12)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="问题类型">
                  <Select
                    value={issue.category}
                    onChange={(event) =>
                      updateIssue(index, {
                        category: event.target.value as typeof issue.category,
                      })
                    }
                  >
                    {Object.entries(categories).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <AssetAnchor
                className={styles.issuePhoto}
                url={
                  assets.find((asset) => asset.id === issue.assetId)?.url ?? ""
                }
                label={"样衣问题 " + (index + 1) + " 定位"}
                x={issue.x}
                y={issue.y}
                onPoint={(x, y) => updateIssue(index, { x, y })}
              />
              <Field label="问题描述">
                <Input
                  value={issue.text}
                  required
                  maxLength={120}
                  onChange={(event) =>
                    updateIssue(index, { text: event.target.value })
                  }
                />
              </Field>
              <div className={styles.formGrid}>
                <Field label="处理状态">
                  <Select
                    value={issue.status}
                    onChange={(event) =>
                      updateIssue(index, {
                        status: event.target.value as typeof issue.status,
                      })
                    }
                  >
                    {Object.entries(states).map(([value, label]) => (
                      <option
                        value={value}
                        disabled={
                          value === "VERIFIED" && !data.capabilities.review
                        }
                        key={value}
                      >
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="负责人">
                  <Select
                    value={issue.assigneeId ?? ""}
                    onChange={(event) =>
                      update(
                        "issues",
                        draft.issues.map((item, at) => {
                          if (at !== index) return item;
                          const next = { ...item };
                          if (event.target.value)
                            next.assigneeId = event.target.value;
                          else delete next.assigneeId;
                          return next;
                        }),
                      )
                    }
                  >
                    <option value="">暂未指派</option>
                    {data.members.map((member) => (
                      <option value={member.userId} key={member.id}>
                        {member.email}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field
                label="处理意见与复核依据"
                hint={
                  issue.status !== "OPEN"
                    ? "已修改和已复核关闭必须填写处理依据。"
                    : "记录处理建议和复查要点。"
                }
              >
                <Textarea
                  required={issue.status !== "OPEN"}
                  rows={3}
                  maxLength={2000}
                  value={issue.resolution}
                  onChange={(event) =>
                    updateIssue(index, { resolution: event.target.value })
                  }
                />
              </Field>
              <Button
                onClick={() =>
                  update(
                    "issues",
                    draft.issues.filter((_, at) => at !== index),
                  )
                }
              >
                移除此问题
              </Button>
            </fieldset>
          ))}
        </section>
        <Field label="本轮补充说明">
          <Textarea
            rows={3}
            maxLength={2000}
            value={draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
        </Field>
      </fieldset>
      <SaveBar
        busy={form.busy || uploading}
        dirty={form.dirty || !existing}
        canEdit={canEdit}
      >
        {existing ? (
          <Button
            disabled={!canEdit || form.dirty}
            onClick={() => void onNextRound(draft)}
          >
            带入未关闭问题，建立下一轮
          </Button>
        ) : null}
        {existing && data.capabilities.review && !canEdit ? (
          <Button
            loading={form.busy}
            disabled={!draft.issues.some((issue) => issue.status === "FIXED")}
            onClick={() => void verifyFixed()}
          >
            复核并关闭已修改问题
          </Button>
        ) : null}
      </SaveBar>
      {existing ? (
        <details className={styles.record}>
          <summary>查看本轮修订历史</summary>
          {existing.revisions.map((revision) => {
            const sample = revision.payload as Sample;
            return (
              <article className={styles.record} key={revision.id}>
                <strong>
                  r{revision.revision} · {sample.name}
                </strong>
                <p className={styles.muted}>
                  {sample.issues.length} 个问题，
                  {
                    sample.issues.filter((issue) => issue.status === "VERIFIED")
                      .length
                  }{" "}
                  个已关闭。
                </p>
                <small>
                  {new Date(revision.createdAt).toLocaleString("zh-CN")}
                </small>
              </article>
            );
          })}
        </details>
      ) : null}
    </form>
  );
}
