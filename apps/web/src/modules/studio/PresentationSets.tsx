"use client";
import { useState } from "react";
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
  Notice,
  Select,
  Textarea,
} from "../../components/ui";
import { saveStudioDocument } from "./studio-api";
import { AssetPicker, SaveBar } from "./studio-ui";
import { useStudioForm, type StudioPanelProps } from "./use-studio-form";
import { TechPackExportButton } from "./TechPackExportButton";
import styles from "./studio.module.css";
type Presentation = (typeof studioPresentationSchema)["_output"];
const KIND_LABELS = {
  front: "正面",
  back: "背面",
  detail: "细节",
  scene: "场景",
};
export function PresentationSets(
  props: StudioPanelProps & {
    readonly data: StudioSummary;
    readonly onGenerate: () => void;
  },
) {
  const [id, setId] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const existing = props.data.presentationSets.find((item) => item.id === id);
  return (
    <section className={styles.section}>
      <div className={styles.recordHeader}>
        <div>
          <h2>商品展示包</h2>
          <p className={styles.muted}>
            将已选定款式整理为可复核、可下载的展示素材。每组保留所采用的款式修订。
          </p>
        </div>
        <div className={styles.toolbar}>
          <Button disabled={!props.canEdit} onClick={props.onGenerate}>
            生成展示候选
          </Button>
          <Button
            disabled={!props.canEdit}
            onClick={() =>
              void (async () => {
                if (await props.beforeChange()) {
                  setId(null);
                  setDraftVersion((current) => current + 1);
                }
              })()
            }
          >
            新建展示包
          </Button>
        </div>
      </div>
      <div className={styles.split}>
        <aside className={styles.rail} aria-label="商品展示包列表">
          {props.data.presentationSets.map((item) => (
            <Button
              key={item.id}
              aria-pressed={id === item.id}
              onClick={() =>
                void (async () => {
                  if (await props.beforeChange()) setId(item.id);
                })()
              }
            >
              <strong>{item.currentRevision.payload.name}</strong>
              <small>修订 {item.version}</small>
            </Button>
          ))}
        </aside>
        <PresentationForm
          key={
            (existing?.id ?? "new") +
            ":" +
            (existing?.version ?? 0) +
            ":" +
            draftVersion
          }
          {...props}
          existing={existing}
          onCreated={setId}
        />
      </div>
    </section>
  );
}
function PresentationForm({
  data,
  projectId,
  canEdit,
  onDirty,
  onSaved,
  beforeChange,
  existing,
  onCreated,
}: StudioPanelProps & {
  readonly data: StudioSummary;
  readonly existing: StudioDocumentView | undefined;
  readonly onCreated: (id: string) => void;
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
  const disabled = !canEdit || form.busy;
  const update = <K extends keyof Presentation>(
    key: K,
    value: Presentation[K],
  ) => setDraft((current) => ({ ...current, [key]: value, status: "DRAFT" }));
  const save = async (ready = false) => {
    const parsed = studioPresentationSchema.safeParse({
      ...draft,
      status: ready ? "READY" : "DRAFT",
    });
    if (!parsed.success) {
      form.setError(parsed.error.issues[0]?.message ?? "请检查展示资料");
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
      <div className={styles.recordHeader}>
        <h3>{existing ? initial.name : "整理展示素材"}</h3>
        <Badge>{draft.status === "READY" ? "已核对" : "草稿"}</Badge>
      </div>
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
      <fieldset className={styles.form} disabled={disabled}>
        <div className={styles.formGrid}>
          <Field label="展示包名称">
            <Input
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
                update("channel", event.target.value as Presentation["channel"])
              }
            >
              <option value="marketplace">商品详情页</option>
              <option value="social">社交媒体</option>
              <option value="lookbook">系列 Lookbook</option>
            </Select>
          </Field>
        </div>
        <Field label="采用款式修订">
          <Select
            required
            value={draft.styleRevisionId}
            onChange={(event) => update("styleRevisionId", event.target.value)}
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
        <AssetPicker
          assets={data.assets}
          selected={draft.items.map((item) => item.assetId)}
          max={12}
          label="选择展示图片"
          onChange={(ids) =>
            update(
              "items",
              ids.map(
                (assetId) =>
                  draft.items.find((item) => item.assetId === assetId) ?? {
                    assetId,
                    kind: "detail",
                    label: "",
                    reviewed: false,
                  },
              ),
            )
          }
        />
        {draft.items.map((item, index) => (
          <article className={styles.record} key={item.assetId}>
            <div className={styles.formGrid}>
              <Field label={"图片 " + (index + 1) + " 视图"}>
                <Select
                  value={item.kind}
                  onChange={(event) =>
                    update(
                      "items",
                      draft.items.map((row, at) =>
                        at === index
                          ? {
                              ...row,
                              kind: event.target.value as typeof item.kind,
                              reviewed: false,
                            }
                          : row,
                      ),
                    )
                  }
                >
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={"图片 " + (index + 1) + " 说明"}>
                <Input
                  required
                  maxLength={120}
                  value={item.label}
                  onChange={(event) =>
                    update(
                      "items",
                      draft.items.map((row, at) =>
                        at === index
                          ? {
                              ...row,
                              label: event.target.value,
                              reviewed: false,
                            }
                          : row,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={item.reviewed}
                onChange={(event) =>
                  update(
                    "items",
                    draft.items.map((row, at) =>
                      at === index
                        ? { ...row, reviewed: event.target.checked }
                        : row,
                    ),
                  )
                }
              />
              已人工核对图片 {index + 1} 的服装结构、色彩与展示内容
            </label>
          </article>
        ))}
        <Field label="展示说明">
          <Textarea
            rows={4}
            maxLength={2000}
            value={draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
        </Field>
      </fieldset>
      <p className={styles.note}>
        展示图片只用于视觉表达。请检查生成图是否保留原款细节；图片不能验证真实尺寸、材质性能或合体性。标记已核对后仍需按实际渠道规范使用。
      </p>
      <SaveBar
        busy={form.busy}
        dirty={form.dirty || !existing}
        canEdit={canEdit}
      >
        <Button
          disabled={!canEdit}
          loading={form.busy}
          onClick={() => void save(true)}
        >
          核对并完成展示包
        </Button>
        {existing ? (
          <TechPackExportButton
            projectId={projectId}
            revisionId={existing.currentRevision.id}
            sourceType="presentation_set"
          />
        ) : null}
      </SaveBar>
      {existing ? (
        <section className={styles.section}>
          <h3>已保存的展示素材</h3>
          <div className={styles.toolbar}>
            {(existing.currentRevision.payload as Presentation).items.map(
              (item, index) => (
                <a
                  className={styles.link}
                  key={item.assetId}
                  href={
                    "/api/design-assets/" +
                    encodeURIComponent(item.assetId) +
                    "/content"
                  }
                  download
                >
                  {"下载图片 " + (index + 1) + " · " + KIND_LABELS[item.kind]}
                </a>
              ),
            )}
          </div>
          <details className={styles.record}>
            <summary>展示包修订历史</summary>
            {existing.revisions.map((revision) => (
              <article className={styles.record} key={revision.id}>
                <strong>
                  修订 {revision.revision} · {revision.payload.name}
                </strong>
                <small>
                  {new Date(revision.createdAt).toLocaleString("zh-CN")}
                </small>
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
    </form>
  );
}
